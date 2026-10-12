/**
 * Xiangqi (Chinese chess) rules — pure functions, zero Three.js / DOM imports.
 *
 * Board: 9 files × 10 ranks, pieces sit on INTERSECTIONS.
 *   sq = rank * 9 + file       file 0..8 = a..i (left→right from Red's seat)
 *                              rank 0..9 (0 = Red's back rank, 9 = Black's back rank)
 * The river lies between rank 4 and rank 5.
 *
 * Piece codes: Red = +1..+7, Black = −1..−7
 *   1 General  2 Advisor  3 Elephant  4 Horse  5 Chariot  6 Cannon  7 Soldier
 *
 * Moves are packed integers: from | (to << 7).
 */

export const FILES = 9;
export const RANKS = 10;
export const NUM_SQ = 90;

export enum PT {
  General = 1,
  Advisor = 2,
  Elephant = 3,
  Horse = 4,
  Chariot = 5,
  Cannon = 6,
  Soldier = 7,
}

export type Side = 0 | 1; // 0 = Red, 1 = Black
export const RED: Side = 0;
export const BLACK: Side = 1;

export type Move = number;
export const mkMove = (from: number, to: number): Move => from | (to << 7);
export const moveFrom = (m: Move): number => m & 127;
export const moveTo = (m: Move): number => m >> 7;

export const sqOf = (file: number, rank: number): number => rank * 9 + file;
export const fileOf = (sq: number): number => sq % 9;
export const rankOf = (sq: number): number => (sq / 9) | 0;

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

const FEN_CHARS = 'kabnrcp'; // index+1 = piece type
export const pieceSide = (p: number): Side => (p > 0 ? RED : BLACK);
export const pieceType = (p: number): PT => (Math.abs(p) as PT);

/* ─────────────────────────── precomputed tables ─────────────────────────── */

interface Jump {
  /** blocking square (horse leg / elephant eye); -1 if none */
  block: number;
  to: number;
}

const GENERAL_STEPS: number[][] = [];
const ADVISOR_STEPS: number[][] = [];
const ELEPHANT_JUMPS: Jump[][] = [];
const HORSE_JUMPS: Jump[][] = [];

const inBoard = (f: number, r: number) => f >= 0 && f < 9 && r >= 0 && r < 10;
const inPalace = (f: number, r: number, side: Side) =>
  f >= 3 && f <= 5 && (side === RED ? r <= 2 : r >= 7);

(function buildTables() {
  for (let sq = 0; sq < NUM_SQ; sq++) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    // general / advisor tables are per side (palace differs) → index sq*2+side
    for (const side of [RED, BLACK] as Side[]) {
      const g: number[] = [];
      const a: number[] = [];
      if (inPalace(f, r, side)) {
        for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (inPalace(f + df, r + dr, side)) g.push(sqOf(f + df, r + dr));
        }
        for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (inPalace(f + df, r + dr, side)) a.push(sqOf(f + df, r + dr));
        }
      }
      GENERAL_STEPS[sq * 2 + side] = g;
      ADVISOR_STEPS[sq * 2 + side] = a;
    }
    // elephant (own half enforced at generation time via side)
    const e: Jump[] = [];
    for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tf = f + 2 * df;
      const tr = r + 2 * dr;
      if (inBoard(tf, tr)) e.push({ block: sqOf(f + df, r + dr), to: sqOf(tf, tr) });
    }
    ELEPHANT_JUMPS[sq] = e;
    // horse
    const h: Jump[] = [];
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lf = f + df;
      const lr = r + dr;
      if (!inBoard(lf, lr)) continue;
      const leg = sqOf(lf, lr);
      if (df !== 0) {
        for (const s of [1, -1]) if (inBoard(f + 2 * df, r + s)) h.push({ block: leg, to: sqOf(f + 2 * df, r + s) });
      } else {
        for (const s of [1, -1]) if (inBoard(f + s, r + 2 * dr)) h.push({ block: leg, to: sqOf(f + s, r + 2 * dr) });
      }
    }
    HORSE_JUMPS[sq] = h;
  }
})();

/* ───────────────────────────── zobrist hashing ──────────────────────────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
const rng = mulberry32(0xc0ffee);
const Z_PIECE_HI = new Uint32Array(15 * NUM_SQ);
const Z_PIECE_LO = new Uint32Array(15 * NUM_SQ);
for (let i = 0; i < Z_PIECE_HI.length; i++) {
  Z_PIECE_HI[i] = rng();
  Z_PIECE_LO[i] = rng();
}
const Z_SIDE_HI = rng();
const Z_SIDE_LO = rng();
const zi = (p: number, sq: number) => (p + 7) * NUM_SQ + sq;

/* ──────────────────────────────── Position ──────────────────────────────── */

export type GameResult =
  | { over: false }
  | { over: true; winner: Side; reason: 'checkmate' | 'stalemate' }
  | { over: true; winner: null; reason: 'repetition' };

interface Undo {
  m: Move;
  captured: number;
  hHi: number;
  hLo: number;
}

export class Position {
  /** 90 intersections, 0 = empty */
  readonly board = new Int8Array(NUM_SQ);
  side: Side = RED;
  /** general squares, index by side */
  readonly kingSq: [number, number] = [-1, -1];
  private hHi = 0;
  private hLo = 0;
  private stack: Undo[] = [];
  /** 53-bit position keys including the starting position */
  private keys: number[] = [];

  /* ---------------- construction ---------------- */

  static initial(): Position {
    return Position.fromFen(START_FEN);
  }

  static fromFen(fen: string): Position {
    const p = new Position();
    const [rows, stm = 'w'] = fen.trim().split(/\s+/);
    const ranks = rows.split('/');
    if (ranks.length !== 10) throw new Error('Bad FEN: need 10 ranks');
    for (let i = 0; i < 10; i++) {
      const rank = 9 - i;
      let file = 0;
      for (const ch of ranks[i]) {
        if (ch >= '0' && ch <= '9') {
          file += +ch;
        } else {
          const lower = ch.toLowerCase();
          const t = FEN_CHARS.indexOf(lower) + 1;
          if (t <= 0 || file > 8) throw new Error('Bad FEN char ' + ch);
          p.board[sqOf(file, rank)] = ch === lower ? -t : t;
          file++;
        }
      }
      if (file !== 9) throw new Error('Bad FEN rank width: ' + ranks[i]);
    }
    p.side = stm === 'b' ? BLACK : RED;
    p.rebuild();
    return p;
  }

  toFen(): string {
    const out: string[] = [];
    for (let rank = 9; rank >= 0; rank--) {
      let s = '';
      let empty = 0;
      for (let file = 0; file < 9; file++) {
        const pc = this.board[sqOf(file, rank)];
        if (!pc) {
          empty++;
          continue;
        }
        if (empty) {
          s += empty;
          empty = 0;
        }
        const c = FEN_CHARS[Math.abs(pc) - 1];
        s += pc > 0 ? c.toUpperCase() : c;
      }
      if (empty) s += empty;
      out.push(s);
    }
    return out.join('/') + (this.side === RED ? ' w' : ' b');
  }

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.side = this.side;
    p.kingSq[0] = this.kingSq[0];
    p.kingSq[1] = this.kingSq[1];
    p.hHi = this.hHi;
    p.hLo = this.hLo;
    p.stack = this.stack.slice();
    p.keys = this.keys.slice();
    return p;
  }

  private rebuild() {
    this.kingSq[0] = this.kingSq[1] = -1;
    this.hHi = this.hLo = 0;
    for (let sq = 0; sq < NUM_SQ; sq++) {
      const pc = this.board[sq];
      if (!pc) continue;
      if (Math.abs(pc) === PT.General) this.kingSq[pieceSide(pc)] = sq;
      this.hHi ^= Z_PIECE_HI[zi(pc, sq)];
      this.hLo ^= Z_PIECE_LO[zi(pc, sq)];
    }
    if (this.side === BLACK) {
      this.hHi ^= Z_SIDE_HI;
      this.hLo ^= Z_SIDE_LO;
    }
    this.stack = [];
    this.keys = [this.key()];
  }

  /** 53-bit hash of (placement, side to move) */
  key(): number {
    return (this.hHi >>> 0) * 2097152 + ((this.hLo >>> 0) & 0x1fffff);
  }

  get ply(): number {
    return this.stack.length;
  }

  get lastMove(): Move | null {
    return this.stack.length ? this.stack[this.stack.length - 1].m : null;
  }

  /* ---------------- make / unmake ---------------- */

  makeMove(m: Move): void {
    const from = m & 127;
    const to = m >> 7;
    const pc = this.board[from];
    const cap = this.board[to];
    this.stack.push({ m, captured: cap, hHi: this.hHi, hLo: this.hLo });
    if (cap) {
      this.hHi ^= Z_PIECE_HI[zi(cap, to)];
      this.hLo ^= Z_PIECE_LO[zi(cap, to)];
    }
    this.hHi ^= Z_PIECE_HI[zi(pc, from)] ^ Z_PIECE_HI[zi(pc, to)] ^ Z_SIDE_HI;
    this.hLo ^= Z_PIECE_LO[zi(pc, from)] ^ Z_PIECE_LO[zi(pc, to)] ^ Z_SIDE_LO;
    this.board[to] = pc;
    this.board[from] = 0;
    if (Math.abs(pc) === PT.General) this.kingSq[pieceSide(pc)] = to;
    this.side = (1 - this.side) as Side;
    this.keys.push(this.key());
  }

  unmakeMove(): void {
    const u = this.stack.pop();
    if (!u) return;
    this.keys.pop();
    const from = u.m & 127;
    const to = u.m >> 7;
    const pc = this.board[to];
    this.board[from] = pc;
    this.board[to] = u.captured;
    if (Math.abs(pc) === PT.General) this.kingSq[pieceSide(pc)] = from;
    this.side = (1 - this.side) as Side;
    this.hHi = u.hHi;
    this.hLo = u.hLo;
  }

  /* ---------------- attack detection ---------------- */

  /**
   * Is the general of `side` attacked? Includes the flying-general rule
   * (opposing generals facing on an open file count as an attack).
   */
  inCheck(side: Side): boolean {
    const k = this.kingSq[side];
    if (k < 0) return false;
    return this.isAttacked(k, side);
  }

  /** Is `sq` attacked by the opponent of `defender`? */
  isAttacked(sq: number, defender: Side): boolean {
    const b = this.board;
    const sgn = defender === RED ? -1 : 1; // sign of enemy pieces
    const kf = fileOf(sq);
    const kr = rankOf(sq);

    // Rays: chariot, flying general, cannon.
    for (let d = 0; d < 4; d++) {
      const df = d === 0 ? 1 : d === 1 ? -1 : 0;
      const dr = d === 2 ? 1 : d === 3 ? -1 : 0;
      let f = kf + df;
      let r = kr + dr;
      let screens = 0;
      while (f >= 0 && f < 9 && r >= 0 && r < 10) {
        const pc = b[r * 9 + f];
        if (pc) {
          screens++;
          if (screens === 1) {
            if (pc * sgn > 0) {
              const t = Math.abs(pc);
              if (t === PT.Chariot) return true;
              if (t === PT.General && df === 0) return true; // flying general
            }
          } else {
            if (pc * sgn > 0 && Math.abs(pc) === PT.Cannon) return true;
            break;
          }
        }
        f += df;
        r += dr;
      }
    }

    // Horses: reverse lookup — for each knight offset, the leg sits beside the HORSE.
    for (let i = 0; i < 8; i++) {
      const df = HORSE_DF[i];
      const dr = HORSE_DR[i];
      const hf = kf + df;
      const hr = kr + dr;
      if (hf < 0 || hf > 8 || hr < 0 || hr > 9) continue;
      if (b[hr * 9 + hf] !== sgn * PT.Horse) continue;
      // horse moves (-df,-dr) to reach sq; leg is one step along the long axis
      const lf = Math.abs(df) === 2 ? hf - Math.sign(df) : hf;
      const lr = Math.abs(dr) === 2 ? hr - Math.sign(dr) : hr;
      if (!b[lr * 9 + lf]) return true;
    }

    // Soldiers: enemy soldier directly "behind" (from its own view: in front of) sq, or beside it once crossed.
    if (defender === RED) {
      // black soldiers move toward rank 0
      if (kr + 1 <= 9 && b[(kr + 1) * 9 + kf] === -PT.Soldier) return true;
      if (kr <= 4) {
        if (kf > 0 && b[kr * 9 + kf - 1] === -PT.Soldier) return true;
        if (kf < 8 && b[kr * 9 + kf + 1] === -PT.Soldier) return true;
      }
    } else {
      if (kr - 1 >= 0 && b[(kr - 1) * 9 + kf] === PT.Soldier) return true;
      if (kr >= 5) {
        if (kf > 0 && b[kr * 9 + kf - 1] === PT.Soldier) return true;
        if (kf < 8 && b[kr * 9 + kf + 1] === PT.Soldier) return true;
      }
    }
    return false;
  }

  /* ---------------- move generation ---------------- */

  /** Pseudo-legal moves (may leave own general in check). Writes into `out`. */
  genPseudo(out: Move[], onlyFrom = -1): void {
    const b = this.board;
    const side = this.side;
    const sgn = side === RED ? 1 : -1;
    for (let from = 0; from < NUM_SQ; from++) {
      if (onlyFrom >= 0 && from !== onlyFrom) continue;
      const pc = b[from];
      if (pc * sgn <= 0) continue;
      const f = fileOf(from);
      const r = rankOf(from);
      switch (Math.abs(pc)) {
        case PT.General: {
          const t = GENERAL_STEPS[from * 2 + side];
          for (let i = 0; i < t.length; i++) if (b[t[i]] * sgn <= 0) out.push(from | (t[i] << 7));
          break;
        }
        case PT.Advisor: {
          const t = ADVISOR_STEPS[from * 2 + side];
          for (let i = 0; i < t.length; i++) if (b[t[i]] * sgn <= 0) out.push(from | (t[i] << 7));
          break;
        }
        case PT.Elephant: {
          const t = ELEPHANT_JUMPS[from];
          for (let i = 0; i < t.length; i++) {
            const j = t[i];
            if (b[j.block]) continue; // 塞象眼
            const tr = rankOf(j.to);
            if (side === RED ? tr > 4 : tr < 5) continue; // cannot cross river
            if (b[j.to] * sgn <= 0) out.push(from | (j.to << 7));
          }
          break;
        }
        case PT.Horse: {
          const t = HORSE_JUMPS[from];
          for (let i = 0; i < t.length; i++) {
            const j = t[i];
            if (b[j.block]) continue; // 蹩馬腿
            if (b[j.to] * sgn <= 0) out.push(from | (j.to << 7));
          }
          break;
        }
        case PT.Chariot: {
          for (let d = 0; d < 4; d++) {
            const df = d === 0 ? 1 : d === 1 ? -1 : 0;
            const dr = d === 2 ? 1 : d === 3 ? -1 : 0;
            let tf = f + df;
            let tr = r + dr;
            while (tf >= 0 && tf < 9 && tr >= 0 && tr < 10) {
              const to = tr * 9 + tf;
              const tp = b[to];
              if (!tp) out.push(from | (to << 7));
              else {
                if (tp * sgn < 0) out.push(from | (to << 7));
                break;
              }
              tf += df;
              tr += dr;
            }
          }
          break;
        }
        case PT.Cannon: {
          for (let d = 0; d < 4; d++) {
            const df = d === 0 ? 1 : d === 1 ? -1 : 0;
            const dr = d === 2 ? 1 : d === 3 ? -1 : 0;
            let tf = f + df;
            let tr = r + dr;
            let jumped = false;
            while (tf >= 0 && tf < 9 && tr >= 0 && tr < 10) {
              const to = tr * 9 + tf;
              const tp = b[to];
              if (!jumped) {
                if (!tp) out.push(from | (to << 7));
                else jumped = true;
              } else if (tp) {
                if (tp * sgn < 0) out.push(from | (to << 7));
                break;
              }
              tf += df;
              tr += dr;
            }
          }
          break;
        }
        case PT.Soldier: {
          const fr = r + sgn;
          if (fr >= 0 && fr <= 9 && b[fr * 9 + f] * sgn <= 0) out.push(from | ((fr * 9 + f) << 7));
          const crossed = side === RED ? r >= 5 : r <= 4;
          if (crossed) {
            if (f > 0 && b[r * 9 + f - 1] * sgn <= 0) out.push(from | ((r * 9 + f - 1) << 7));
            if (f < 8 && b[r * 9 + f + 1] * sgn <= 0) out.push(from | ((r * 9 + f + 1) << 7));
          }
          break;
        }
      }
    }
  }

  /** Fully legal moves for the side to move (optionally only from one square). */
  legalMoves(onlyFrom = -1): Move[] {
    const pseudo: Move[] = [];
    this.genPseudo(pseudo, onlyFrom);
    const me = this.side;
    const legal: Move[] = [];
    for (let i = 0; i < pseudo.length; i++) {
      this.makeMove(pseudo[i]);
      if (!this.inCheck(me)) legal.push(pseudo[i]);
      this.unmakeMove();
    }
    return legal;
  }

  /** Number of legal moves (no allocation of the result list) */
  countLegal(): number {
    const pseudo: Move[] = [];
    this.genPseudo(pseudo);
    const me = this.side;
    let n = 0;
    for (let i = 0; i < pseudo.length; i++) {
      this.makeMove(pseudo[i]);
      if (!this.inCheck(me)) n++;
      this.unmakeMove();
    }
    return n;
  }

  isLegal(m: Move): boolean {
    const from = m & 127;
    return this.legalMoves(from).includes(m);
  }

  /* ---------------- teaching helpers ---------------- */

  /**
   * Destinations that a piece's *geometry* allows but are blocked by 蹩馬腿 / 塞象眼.
   * Used by the UI to flash a warning glyph on the blocking piece.
   */
  blockedMoves(from: number): { to: number; blocker: number; kind: 'horse-leg' | 'elephant-eye' }[] {
    const pc = this.board[from];
    const res: { to: number; blocker: number; kind: 'horse-leg' | 'elephant-eye' }[] = [];
    if (!pc) return res;
    const side = pieceSide(pc);
    const sgn = side === RED ? 1 : -1;
    if (Math.abs(pc) === PT.Horse) {
      for (const j of HORSE_JUMPS[from]) {
        if (this.board[j.block] && this.board[j.to] * sgn <= 0) res.push({ to: j.to, blocker: j.block, kind: 'horse-leg' });
      }
    } else if (Math.abs(pc) === PT.Elephant) {
      for (const j of ELEPHANT_JUMPS[from]) {
        const tr = rankOf(j.to);
        if (side === RED ? tr > 4 : tr < 5) continue;
        if (this.board[j.block] && this.board[j.to] * sgn <= 0) res.push({ to: j.to, blocker: j.block, kind: 'elephant-eye' });
      }
    }
    return res;
  }

  /**
   * For a cannon capture, the screen (炮架) square between from and to; −1 otherwise.
   */
  cannonScreen(from: number, to: number): number {
    if (Math.abs(this.board[from]) !== PT.Cannon || !this.board[to]) return -1;
    const f0 = fileOf(from), r0 = rankOf(from), f1 = fileOf(to), r1 = rankOf(to);
    const df = Math.sign(f1 - f0), dr = Math.sign(r1 - r0);
    let f = f0 + df, r = r0 + dr;
    while (f !== f1 || r !== r1) {
      if (this.board[r * 9 + f]) return r * 9 + f;
      f += df;
      r += dr;
    }
    return -1;
  }

  /* ---------------- results ---------------- */

  /** Number of times the current position has occurred (including now). */
  repetitionCount(): number {
    const k = this.keys[this.keys.length - 1];
    let n = 0;
    for (let i = this.keys.length - 1; i >= 0; i -= 2) if (this.keys[i] === k) n++;
    return n;
  }

  result(): GameResult {
    if (this.countLegal() === 0) {
      // 困毙 (no legal moves) is a LOSS for the side to move, same as checkmate.
      return {
        over: true,
        winner: (1 - this.side) as Side,
        reason: this.inCheck(this.side) ? 'checkmate' : 'stalemate',
      };
    }
    if (this.repetitionCount() >= 3) return { over: true, winner: null, reason: 'repetition' };
    return { over: false };
  }

  /* ---------------- misc ---------------- */

  pieceAt(file: number, rank: number): number {
    return this.board[sqOf(file, rank)];
  }

  /** Static material count in simple units, for UI / evaluation fallbacks */
  static readonly VALUE: Record<number, number> = { 1: 0, 2: 2, 3: 2, 4: 4, 5: 9, 6: 4.5, 7: 1 };
}

const HORSE_DF = [2, 2, -2, -2, 1, -1, 1, -1];
const HORSE_DR = [1, -1, 1, -1, 2, 2, -2, -2];

/* ─────────────────────────────── perft ─────────────────────────────── */

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  if (depth === 1) return pos.countLegal();
  const moves = pos.legalMoves();
  let n = 0;
  for (let i = 0; i < moves.length; i++) {
    pos.makeMove(moves[i]);
    n += perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return n;
}

/** Per-root-move split, handy for diffing against a reference engine */
export function perftDivide(pos: Position, depth: number): Map<string, number> {
  const res = new Map<string, number>();
  for (const m of pos.legalMoves()) {
    pos.makeMove(m);
    res.set(moveToIccs(m), perft(pos, depth - 1));
    pos.unmakeMove();
  }
  return res;
}

/* ─────────────────────── coordinate (ICCS / UCCI) text ────────────────────── */

export function sqToIccs(sq: number): string {
  return String.fromCharCode(97 + fileOf(sq)) + rankOf(sq);
}
export function iccsToSq(s: string): number {
  return sqOf(s.charCodeAt(0) - 97, +s[1]);
}
export function moveToIccs(m: Move): string {
  return sqToIccs(moveFrom(m)) + sqToIccs(moveTo(m));
}
export function iccsToMove(s: string): Move {
  return mkMove(iccsToSq(s.slice(0, 2)), iccsToSq(s.slice(2, 4)));
}
