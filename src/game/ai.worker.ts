/// <reference lib="webworker" />
import { Position, iccsToMove, moveToIccs } from './rules';
import { Searcher, Level } from './ai';

interface Req {
  id: number;
  /** moves played from the standard start position, in ICCS (keeps repetition history) */
  moves: string[];
  level: Level;
  timeMs?: number;
}

const searcher = new Searcher();

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, moves, level, timeMs } = e.data;
  const pos = Position.initial();
  for (const m of moves) pos.makeMove(iccsToMove(m));
  const res = searcher.search(pos, { level, timeMs });
  (self as unknown as Worker).postMessage({ id, move: res.move ? moveToIccs(res.move) : null, score: res.score, depth: res.depth, nodes: res.nodes, ms: res.ms });
};
