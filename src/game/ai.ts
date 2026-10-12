/**
 * Xiangqi search engine (own implementation): iterative-deepening alpha-beta (negamax) with a
 * transposition table, MVV-LVA / killer / history move ordering, check extensions and quiescence
 * search, over tuned piece-square tables. Pure TypeScript — runs inside ai.worker.ts.
 */
import { Position, Move, PT, RED, mkMove, moveFrom, moveTo, rankOf, fileOf, NUM_SQ, iccsToMove } from './rules';

export type Level = 'recruit' | 'captain' | 'general' | 'master';

export interface SearchOptions {
  level: Level;
  /** override the level's time budget (ms) */
  timeMs?: number;
}

export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  nodes: number;
  ms: number;
}

const MATE = 30000;
const VALUE: Record<number, number> = { [PT.General]: 0, [PT.Advisor]: 200, [PT.Elephant]: 200, [PT.Horse]: 430, [PT.Chariot]: 950, [PT.Cannon]: 460, [PT.Soldier]: 100 };

/* ───────────── piece-square tables (Red's perspective; Black mirrors rank) ───────────── */

const PST: Record<number, Int16Array> = {};
function buildPst() {
  for (const t of [PT.General, PT.Advisor, PT.Elephant, PT.Horse, PT.Chariot, PT.Cannon, PT.Soldier]) PST[t] = new Int16Array(NUM_SQ);
  for (let sq = 0; sq < NUM_SQ; sq++) {
    const f = fileOf(sq), r = rankOf(sq);
    const cen = 4 - Math.abs(f - 4); // 0 at the rim, 4 on the central file
    const crossed = r >= 5;
    // soldier: pushes forward, strong once across the river, best near the enemy palace, useless on the last rank
    let s = 0;
    if (!crossed) s = r === 3 ? 0 : r === 4 ? 12 : 0;
    else s = 70 + (r - 5) * 14 + cen * 5 - (r === 9 ? 45 : 0);
    if (!crossed && (f === 0 || f === 8)) s -= 3;
    PST[PT.Soldier][sq] = s;
    // horse: centre and advancement, hates the rim and the back rank
    PST[PT.Horse][sq] = cen * 7 + Math.min(r, 8) * 4 + (crossed ? 12 : 0) - (f === 0 || f === 8 ? 14 : 0) - (r === 0 ? 10 : 0) - (r === 9 ? 25 : 0);
    // chariot: activity — advancement, the 7th rank bonus, open central files
    PST[PT.Chariot][sq] = Math.min(r, 8) * 3 + cen * 2 + (r === 7 || r === 8 ? 10 : 0) + (crossed ? 10 : 0);
    // cannon: central file, middle ranks; weaker on the far rim
    PST[PT.Cannon][sq] = cen * 5 + (r >= 2 && r <= 7 ? 8 : 0) + (crossed ? 6 : 0) - (r === 0 ? 4 : 0) - (f === 0 || f === 8 ? 8 : 0);
    // advisor / elephant: reward the classic squares
    PST[PT.Advisor][sq] = f === 4 && r === 1 ? 12 : 0;
    PST[PT.Elephant][sq] = f === 4 && r === 2 ? 14 : (f === 2 || f === 6) && r === 0 ? 4 : 0;
    // general: stay home, avoid stepping up the palace
    PST[PT.General][sq] = r === 0 ? 6 : r === 1 ? 0 : -14;
  }
}
buildPst();

function evaluate(pos: Position): number {
  const b = pos.board;
  let score = 0; // Red-positive
  let redDef = 0, blackDef = 0;
  for (let sq = 0; sq < NUM_SQ; sq++) {
    const pc = b[sq];
    if (!pc) continue;
    const t = Math.abs(pc);
    if (pc > 0) {
      score += VALUE[t] + PST[t][sq];
      if (t === PT.Advisor || t === PT.Elephant) redDef++;
    } else {
      const mirror = (9 - rankOf(sq)) * 9 + fileOf(sq);
      score -= VALUE[t] + PST[t][mirror];
      if (t === PT.Advisor || t === PT.Elephant) blackDef++;
    }
  }
  // intact defences matter when heavy pieces remain
  score += (redDef - blackDef) * 8;
  return pos.side === RED ? score : -score;
}

/* ───────────── tiny opening book (first two plies only) ───────────── */

// Red's first move: 当头炮 / 中炮, 飞相, 起马, pawn pushes
const BOOK_RED = ['h2e2', 'b2e2', 'c0e2', 'g0e2', 'h0g2', 'b0c2', 'c3c4', 'g3g4', 'h2e2', 'b2e2'];
// Black's first reply (screen-cannon, horse development, elephants, pawn pushes)
const BOOK_BLACK = ['b9c7', 'h9g7', 'b7e7', 'h7e7', 'c6c5', 'g6g5', 'g9e7', 'c9e7', 'h9g7', 'b9c7'];
const QUIET_FIRST = new Set([...BOOK_RED, 'a3a4', 'i3i4', 'e3e4']);

function bookMove(pos: Position): Move {
  const n = pos.ply;
  if (n > 1) return 0;
  const legal = pos.legalMoves();
  const pick = (list: string[]) => {
    const cands = list.map(iccsToMove).filter((m) => legal.includes(m));
    return cands.length ? cands[Math.floor(Math.random() * cands.length)] : 0;
  };
  if (n === 0) return pick(BOOK_RED);
  // reply only if Red's first move was an ordinary quiet one
  const last = pos.lastMove;
  if (last === null) return 0;
  const from = String.fromCharCode(97 + (moveFrom(last) % 9)) + Math.floor(moveFrom(last) / 9);
  const to = String.fromCharCode(97 + (moveTo(last) % 9)) + Math.floor(moveTo(last) / 9);
  return QUIET_FIRST.has(from + to) ? pick(BOOK_BLACK) : 0;
}

/* ───────────── search ───────────── */

interface TTEntry { depth: number; score: number; flag: 0 | 1 | 2; move: Move }

const LEVELS: Record<Level, { maxDepth: number; timeMs: number; temp: number; rootFull: boolean }> = {
  recruit: { maxDepth: 2, timeMs: 400, temp: 140, rootFull: true },
  captain: { maxDepth: 3, timeMs: 700, temp: 45, rootFull: true },
  general: { maxDepth: 5, timeMs: 1500, temp: 0, rootFull: false },
  master: { maxDepth: 9, timeMs: 3200, temp: 0, rootFull: false },
};

class Stop extends Error {}

export class Searcher {
  private tt = new Map<number, TTEntry>();
  private killers: Int32Array = new Int32Array(64 * 2);
  private history = new Int32Array(NUM_SQ * NUM_SQ);
  private nodes = 0;
  private deadline = 0;
  private pos!: Position;

  clear() {
    this.tt.clear();
    this.history.fill(0);
    this.killers.fill(0);
  }

  private checkTime() {
    if ((this.nodes & 2047) === 0 && performance.now() > this.deadline) throw new Stop();
  }

  private score(m: Move, ttMove: Move, ply: number): number {
    if (m === ttMove) return 1_000_000;
    const v = this.pos.board[moveTo(m)];
    if (v) {
      const a = Math.abs(this.pos.board[moveFrom(m)]);
      return 100_000 + VALUE[Math.abs(v)] * 16 - VALUE[a] / 8 + (Math.abs(v) === PT.General ? 100000 : 0);
    }
    if (m === this.killers[ply * 2]) return 90_000;
    if (m === this.killers[ply * 2 + 1]) return 80_000;
    return this.history[moveFrom(m) * NUM_SQ + moveTo(m)];
  }

  private order(moves: Move[], ttMove: Move, ply: number): Move[] {
    const sc = moves.map((m) => this.score(m, ttMove, ply));
    const idx = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
    return idx.map((i) => moves[i]);
  }

  private qsearch(alpha: number, beta: number, ply: number, qd: number): number {
    this.nodes++;
    this.checkTime();
    const pos = this.pos;
    const stand = evaluate(pos);
    if (qd <= 0) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const caps = pos.legalCaptures();
    if (!caps.length) return stand;
    const ordered = this.order(caps, 0, ply);
    for (const m of ordered) {
      pos.makeMove(m);
      const s = -this.qsearch(-beta, -alpha, ply + 1, qd - 1);
      pos.unmakeMove();
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, ext: number): number {
    this.nodes++;
    this.checkTime();
    const pos = this.pos;
    if (ply > 0 && pos.isRepeat()) return 0;
    const inCheck = pos.inCheck(pos.side);
    if (inCheck && ext < 6) { depth++; ext++; }
    if (depth <= 0) return this.qsearch(alpha, beta, ply, 6);

    const key = pos.key();
    const tt = this.tt.get(key);
    let ttMove: Move = 0;
    if (tt) {
      ttMove = tt.move;
      if (tt.depth >= depth && ply > 0) {
        if (tt.flag === 0) return tt.score;
        if (tt.flag === 1 && tt.score >= beta) return tt.score;
        if (tt.flag === 2 && tt.score <= alpha) return tt.score;
      }
    }

    const pseudo: Move[] = [];
    pos.genPseudo(pseudo);
    const ordered = this.order(pseudo, ttMove, ply);
    const me = pos.side;
    let best = -MATE;
    let bestMove: Move = 0;
    let legal = 0;
    const a0 = alpha;
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      pos.makeMove(m);
      if (pos.inCheck(me)) { pos.unmakeMove(); continue; }
      legal++;
      let s: number;
      // late-move reduction on quiet moves deep in the list
      if (legal > 6 && depth >= 3 && !inCheck && !this.pos.board[moveTo(m)] && !pos.inCheck(pos.side)) {
        s = -this.negamax(depth - 2, -alpha - 1, -alpha, ply + 1, ext);
        if (s > alpha) s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, ext);
      } else {
        s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, ext);
      }
      pos.unmakeMove();
      if (s > best) {
        best = s;
        bestMove = m;
        if (s > alpha) alpha = s;
        if (alpha >= beta) {
          if (!pos.board[moveTo(m)]) {
            if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
            this.history[moveFrom(m) * NUM_SQ + moveTo(m)] += depth * depth;
          }
          break;
        }
      }
    }
    // 困毙: no legal moves is a LOSS (same as being checkmated)
    if (legal === 0) return -MATE + ply;
    const flag: 0 | 1 | 2 = best <= a0 ? 2 : best >= beta ? 1 : 0;
    if (this.tt.size > 1_500_000) this.tt.clear();
    this.tt.set(key, { depth, score: best, flag, move: bestMove });
    return best;
  }

  search(pos: Position, opts: SearchOptions): SearchResult {
    const L = LEVELS[opts.level];
    const t0 = performance.now();
    this.pos = pos.clone();
    this.nodes = 0;
    this.deadline = t0 + (opts.timeMs ?? L.timeMs);
    const book = opts.level === 'recruit' ? 0 : bookMove(this.pos);
    if (book) return { move: book, score: 0, depth: 0, nodes: 0, ms: performance.now() - t0 };
    const rootMoves = this.pos.legalMoves();
    if (!rootMoves.length) return { move: 0, score: -MATE, depth: 0, nodes: 0, ms: 0 };
    if (rootMoves.length === 1) return { move: rootMoves[0], score: 0, depth: 0, nodes: 1, ms: performance.now() - t0 };

    let bestMove = rootMoves[0];
    let bestScore = -MATE;
    let reached = 0;
    let rootScores: { m: Move; s: number }[] = [];

    if (L.rootFull) {
      // weak levels: score every root move at a fixed depth, then choose with a softmax-ish temperature
      const depth = L.maxDepth;
      try {
        const scored: { m: Move; s: number }[] = [];
        for (const m of this.order(rootMoves, 0, 0)) {
          this.pos.makeMove(m);
          const s = this.pos.isRepeat() ? 0 : -this.negamax(depth - 1, -MATE, MATE, 1, 0);
          this.pos.unmakeMove();
          scored.push({ m, s });
        }
        rootScores = scored;
        reached = depth;
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
      }
      if (rootScores.length) {
        rootScores.sort((a, b) => b.s - a.s);
        bestScore = rootScores[0].s;
        bestMove = rootScores[0].m;
        if (L.temp > 0 && bestScore < MATE - 100) {
          // never play a move that walks into a forced mate if a better one exists; otherwise sample
          const pool = rootScores.filter((x) => x.s > -MATE + 200);
          const weights = pool.map((x) => Math.exp((x.s - bestScore) / L.temp));
          const total = weights.reduce((a, b) => a + b, 0);
          let r = Math.random() * total;
          for (let i = 0; i < pool.length; i++) {
            r -= weights[i];
            if (r <= 0) { bestMove = pool[i].m; bestScore = pool[i].s; break; }
          }
        }
      }
    } else {
      // iterative deepening with aspiration-free full window (shallow enough for xiangqi branching)
      let ttRoot: Move = 0;
      for (let depth = 1; depth <= L.maxDepth; depth++) {
        try {
          const ordered = this.order(rootMoves, ttRoot || bestMove, 0);
          let alpha = -MATE, bestHere = ordered[0], scoreHere = -MATE;
          for (const m of ordered) {
            this.pos.makeMove(m);
            const s = this.pos.isRepeat() ? 0 : -this.negamax(depth - 1, -MATE, -alpha, 1, 0);
            this.pos.unmakeMove();
            if (s > scoreHere) {
              scoreHere = s;
              bestHere = m;
              if (s > alpha) alpha = s;
            }
          }
          bestMove = bestHere;
          bestScore = scoreHere;
          ttRoot = bestHere;
          reached = depth;
          if (Math.abs(scoreHere) > MATE - 100) break; // forced mate found
        } catch (e) {
          if (!(e instanceof Stop)) throw e;
          break;
        }
        if (performance.now() > this.deadline) break;
      }
    }
    return { move: bestMove, score: bestScore, depth: reached, nodes: this.nodes, ms: performance.now() - t0 };
  }
}

export { mkMove };
