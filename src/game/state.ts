import { Position, Move, Side, GameResult, RED, BLACK, moveFrom, moveTo } from './rules';
import { chineseNotation, wxfNotation } from './notation';
import { moveToIccs } from './rules';

export interface MoveRecord {
  move: Move;
  side: Side;
  piece: number;
  captured: number;
  gaveCheck: boolean;
  zh: string;
  wxf: string;
  iccs: string;
}

/** Game session: a Position plus the annotated move list (supports undo + replay). */
export class GameState {
  pos = Position.initial();
  records: MoveRecord[] = [];

  reset(): void {
    this.pos = Position.initial();
    this.records = [];
  }

  get turn(): Side {
    return this.pos.side;
  }

  result(): GameResult {
    return this.pos.result();
  }

  /** Annotate and play a legal move. Caller guarantees legality. */
  play(m: Move): MoveRecord {
    const pos = this.pos;
    const piece = pos.board[moveFrom(m)];
    const captured = pos.board[moveTo(m)];
    const zh = chineseNotation(pos, m);
    const wxf = wxfNotation(pos, m);
    const side = pos.side;
    pos.makeMove(m);
    const rec: MoveRecord = {
      move: m, side, piece, captured,
      gaveCheck: pos.inCheck(pos.side), zh, wxf, iccs: moveToIccs(m),
    };
    this.records.push(rec);
    return rec;
  }

  /** Undo the last `plies` half-moves; returns the removed records (newest first). */
  undo(plies = 1): MoveRecord[] {
    const out: MoveRecord[] = [];
    for (let i = 0; i < plies && this.records.length; i++) {
      this.pos.unmakeMove();
      out.push(this.records.pop()!);
    }
    return out;
  }

  /** Captured pieces for a given colour (pieces *lost* by that colour). */
  capturedBy(side: Side): number[] {
    return this.records.filter((r) => r.captured && (r.captured > 0 ? RED : BLACK) !== side).map((r) => r.captured);
  }

  /** Replay helper: a fresh position advanced to move index n. */
  positionAt(n: number): Position {
    const p = Position.initial();
    for (let i = 0; i < n; i++) p.makeMove(this.records[i].move);
    return p;
  }
}
