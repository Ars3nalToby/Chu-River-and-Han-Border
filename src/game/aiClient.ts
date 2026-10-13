import { Position, iccsToMove, moveToIccs, Move, mkMove } from './rules';
import { Searcher, Level } from './ai';

export interface AiReply { move: string | null; score: number; depth: number; nodes: number; ms: number }

/** Runs the search in a Web Worker; falls back to the main thread if workers are unavailable. */
export class AiClient {
  private worker: Worker | null = null;
  private id = 0;
  private pending = new Map<number, (r: AiReply) => void>();
  private requests = new Map<number, { moves: string[]; level: Level; timeMs?: number }>();
  private fallback: Searcher | null = null;
  usingWorker = false;

  constructor() {
    try {
      this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<AiReply & { id: number }>) => {
        const r = this.pending.get(e.data.id);
        if (r) {
          this.pending.delete(e.data.id);
          this.requests.delete(e.data.id);
          r(e.data);
        }
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.usingWorker = false;
        // answer whatever was in flight on the main thread instead
        for (const [id, resolve] of this.pending) {
          const q = this.requests.get(id);
          if (q) void this.think(q.moves, q.level, q.timeMs).then(resolve);
        }
        this.pending.clear();
        this.requests.clear();
      };
      this.usingWorker = true;
    } catch {
      this.worker = null;
    }
  }

  think(moves: string[], level: Level, timeMs?: number): Promise<AiReply> {
    const id = ++this.id;
    if (this.worker) {
      return new Promise((resolve) => {
        this.pending.set(id, resolve);
        this.requests.set(id, { moves, level, timeMs });
        this.worker!.postMessage({ id, moves, level, timeMs });
      });
    }
    // main-thread fallback (deferred so the UI can paint first)
    return new Promise((resolve) => {
      setTimeout(() => {
        this.fallback ??= new Searcher();
        const pos = Position.initial();
        for (const m of moves) pos.makeMove(iccsToMove(m));
        const r = this.fallback.search(pos, { level, timeMs });
        resolve({ move: r.move ? moveToIccs(r.move) : null, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms });
      }, 20);
    });
  }

  /** forget any in-flight request (its reply is simply ignored) */
  cancel(): void {
    this.pending.clear();
    this.requests.clear();
  }
}

export type { Move };
export { mkMove };
