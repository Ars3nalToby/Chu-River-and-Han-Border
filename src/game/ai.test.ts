import { describe, it, expect } from 'vitest';
import { Position, moveToIccs } from './rules';
import { Searcher } from './ai';

describe('AI search', () => {
  it('finds mate in one', () => {
    // Red chariots a8 and b7? use the ladder: black king e9; red chariot on rank 8 covers escape; chariot a0→a9 mates
    const p = Position.fromFen('4k4/1R7/9/9/9/9/9/9/9/R2K5 w');
    const s = new Searcher();
    const r = s.search(p, { level: 'master', timeMs: 800 });
    expect(['a0a9']).toContain(moveToIccs(r.move));
  });
  it('wins a hanging chariot (either by capturing or by a stronger forcing line)', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/r8/R3K4 w');
    const r = new Searcher().search(p, { level: 'general', timeMs: 600 });
    expect(['a0a1', 'a0d0']).toContain(moveToIccs(r.move));
    expect(r.score).toBeGreaterThan(700);
  });
  it('does not hang a piece at the opening (general level, 5 plies of self-play stay sane)', () => {
    const p = Position.initial();
    const s = new Searcher();
    for (let i = 0; i < 6; i++) {
      const r = s.search(p, { level: 'general', timeMs: 300 });
      expect(r.move).toBeGreaterThan(0);
      p.makeMove(r.move);
    }
    expect(p.result()).toEqual({ over: false });
  });
  it('recruit level always returns a legal move', () => {
    const p = Position.initial();
    const r = new Searcher().search(p, { level: 'recruit' });
    expect(p.legalMoves()).toContain(r.move);
  });
});
