/**
 * Independent cross-check of rules.ts against Fairy-Stockfish (WASM, devDependency).
 * Random games from the start position; every few plies we compare the per-root-move
 * perft(2) split against the reference engine. Fairy-Stockfish is NOT used by the game.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Position, moveToIccs, perftDivide, START_FEN } from './rules';

const require_ = createRequire(import.meta.url);

async function loadEngine(): Promise<{ send: (cmd: string) => void; lines: string[] } | null> {
  const savedFetch = (globalThis as any).fetch;
  try {
    (globalThis as any).fetch = undefined; // emscripten glue must take the fs path in Node
    const Stockfish = require_('fairy-stockfish-nnue.wasm/stockfish.js');
    const sf = await Stockfish();
    const lines: string[] = [];
    sf.addMessageListener((l: string) => lines.push(l));
    return { send: (c: string) => sf.postMessage(c), lines };
  } catch (e) {
    console.warn('Fairy-Stockfish oracle unavailable:', (e as Error).message);
    return null;
  } finally {
    (globalThis as any).fetch = savedFetch;
  }
}

// Fairy-SF uses ranks 1..10; ours 0..9
const toFairy = (iccs: string) => iccs.replace(/([a-i])(\d)/g, (_, f, r) => f + (+r + 1));

async function fairyDivide(eng: { send: (c: string) => void; lines: string[] }, fen: string, depth: number) {
  eng.lines.length = 0;
  eng.send(`position fen ${fen} - - 0 1`);
  eng.send(`go perft ${depth}`);
  const t0 = Date.now();
  while (!eng.lines.some((l) => l.startsWith('Nodes searched')) && Date.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const res = new Map<string, number>();
  for (const l of eng.lines) {
    const m = /^([a-i]\d+[a-i]\d+): (\d+)/.exec(l);
    if (m) res.set(m[1], +m[2]);
  }
  return res;
}

describe('oracle: Fairy-Stockfish perft agreement', () => {
  it('matches perft(2) divide on random mid-game positions', async () => {
    const eng = await loadEngine();
    if (!eng) return;
    eng.send('setoption name UCI_Variant value xiangqi');
    // sanity: start position
    const startRef = await fairyDivide(eng, START_FEN, 3);
    expect([...startRef.values()].reduce((a, b) => a + b, 0)).toBe(79666);

    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let positions = 0;
    let nodes = 0;
    for (let game = 0; game < 12; game++) {
      const p = Position.initial();
      for (let ply = 0; ply < 160; ply++) {
        const ms = p.legalMoves();
        if (!ms.length) break;
        // prefer captures a bit so we reach sparse endgames
        p.makeMove(ms[Math.floor(rnd() * ms.length)]);
        if (ply % 9 === 8) {
          const fen = p.toFen();
          const mine = perftDivide(p.clone(), 2);
          const ref = await fairyDivide(eng, fen, 2);
          const mineF = new Map([...mine].map(([k, v]) => [toFairy(k), v]));
          expect(Object.fromEntries([...mineF].sort()), `FEN ${fen}`).toEqual(Object.fromEntries([...ref].sort()));
          positions++;
          nodes += [...mine.values()].reduce((a, b) => a + b, 0);
        }
      }
    }
    console.log(`oracle agreement on ${positions} positions (${nodes.toLocaleString()} perft-2 nodes)`);
    expect(positions).toBeGreaterThan(50);
  });
});
