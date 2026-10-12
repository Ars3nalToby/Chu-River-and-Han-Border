import { describe, it, expect } from 'vitest';
import {
  Position, perft, iccsToMove, iccsToSq, moveToIccs, sqToIccs, RED, BLACK, START_FEN,
} from './rules';

const dests = (p: Position, from: string) =>
  p.legalMoves(iccsToSq(from)).map((m) => sqToIccs(m >> 7)).sort();

describe('perft from the initial position', () => {
  const expected = [44, 1920, 79666, 3290240];
  expected.forEach((n, i) => {
    it(`perft(${i + 1}) = ${n.toLocaleString()}`, () => {
      const p = Position.initial();
      const t0 = performance.now();
      expect(perft(p, i + 1)).toBe(n);
      // eslint-disable-next-line no-console
      console.log(`perft(${i + 1}) = ${n.toLocaleString()}  (${(performance.now() - t0).toFixed(0)} ms)`);
      // position must be fully restored after the search
      expect(p.toFen()).toBe(START_FEN);
    });
  });
});

describe('FEN + hashing', () => {
  it('round-trips FEN', () => {
    expect(Position.initial().toFen()).toBe(START_FEN);
  });
  it('incremental hash equals recomputed hash after random play', () => {
    const p = Position.initial();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 80; i++) {
      const ms = p.legalMoves();
      if (!ms.length) break;
      p.makeMove(ms[Math.floor(rnd() * ms.length)]);
      expect(p.key()).toBe(Position.fromFen(p.toFen()).key());
    }
  });
  it('unmake restores everything', () => {
    const p = Position.initial();
    const before = p.key();
    for (const m of p.legalMoves()) { p.makeMove(m); p.unmakeMove(); }
    expect(p.key()).toBe(before);
    expect(p.toFen()).toBe(START_FEN);
  });
});

describe('flying general (王不見王)', () => {
  it('a piece shielding the generals cannot leave the file', () => {
    // Red K e0, Red chariot e5, Black k e9 → the chariot is pinned to the e-file
    const p = Position.fromFen('4k4/9/9/9/4R4/9/9/9/9/4K4 w');
    const d = dests(p, 'e5');
    expect(d.every((s) => s[0] === 'e')).toBe(true);
    expect(d).toContain('e9'); // may capture the general along the file
    expect(d).not.toContain('d5');
    expect(d).not.toContain('f5');
  });
  it('a general may not step onto a file facing the other general', () => {
    const p = Position.fromFen('4k4/9/9/9/9/9/9/9/9/3K5 w');
    expect(dests(p, 'd0')).not.toContain('e0');
    expect(dests(p, 'd0')).toContain('d1');
    // and with a blocker between them, it is allowed
    const q = Position.fromFen('4k4/9/9/9/4p4/9/9/9/9/3K5 w');
    expect(dests(q, 'd0')).toContain('e0');
  });
});

describe('horse leg (蹩馬腿)', () => {
  it('蹩馬腿: occupied adjacent point stops the jump', () => {
    // Horse on e4 (file e, rank 4); pawn on e5 blocks upward jumps; d6/f6 must vanish
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('e4')] = 4; // red horse
    p.board[iccsToSq('e5')] = -7;
    const d = dests(p, 'e4');
    expect(d).not.toContain('d6');
    expect(d).not.toContain('f6');
    expect(d).toContain('c5');
    expect(d).toContain('g5');
    expect(d).toContain('d2');
    const blocks = p.blockedMoves(iccsToSq('e4'));
    expect(blocks.map((b) => sqToIccs(b.blocker))).toEqual(['e5', 'e5']);
    expect(blocks.every((b) => b.kind === 'horse-leg')).toBe(true);
  });
});

describe('elephant eye (塞象眼) and river limit', () => {
  it('blocked eye prevents only that diagonal', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('c0')] = 3;
    expect(dests(p, 'c0')).toEqual(['a2', 'e2']);
    p.board[iccsToSq('d1')] = 7; // own soldier on the eye of the e2 jump
    expect(dests(p, 'c0')).toEqual(['a2']);
    expect(p.blockedMoves(iccsToSq('c0')).map((b) => sqToIccs(b.blocker))).toEqual(['d1']);
  });
  it('cannot cross the river', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('c4')] = 3;
    expect(dests(p, 'c4')).toEqual(['a2', 'e2']); // a6 / e6 are across the river
    const q = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 b');
    q.board[iccsToSq('c5')] = -3;
    expect(dests(q, 'c5')).toEqual(['a7', 'e7']);
  });
  it('can capture an enemy piece on its landing point', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('c0')] = 3;
    p.board[iccsToSq('e2')] = -5;
    expect(dests(p, 'c0')).toContain('e2');
  });
});

describe('cannon', () => {
  const setup = (screens: string[], target = 'a9') => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('a0')] = 6;
    for (const s of screens) p.board[iccsToSq(s)] = 7; // red soldiers as screens
    p.board[iccsToSq(target)] = -5; // black chariot target
    return p;
  };
  it('0 screens: cannot capture, slides like a chariot up to the target', () => {
    const d = dests(setup([]), 'a0');
    expect(d).not.toContain('a9');
    expect(d).toContain('a8');
  });
  it('1 screen: captures by jumping, cannot move beyond the screen to empty points', () => {
    const d = dests(setup(['a4']), 'a0');
    expect(d).toContain('a9');
    expect(d).toContain('a3'); // slides before the screen
    expect(d).not.toContain('a5'); // empty point behind the screen
    expect(d).not.toContain('a4'); // own screen
  });
  it('1 screen of the ENEMY colour also works', () => {
    const p = setup([]);
    p.board[iccsToSq('a5')] = -7;
    expect(dests(p, 'a0')).toContain('a9');
  });
  it('2 screens: cannot capture the far piece', () => {
    const d = dests(setup(['a4', 'a6']), 'a0');
    expect(d).not.toContain('a9');
    expect(d).toContain('a3');
    expect(d).not.toContain('a5'); // cannot slide past the first screen
  });
  it('2 screens: may capture an enemy screen as the first target', () => {
    // second piece is an enemy: it is capturable (1 screen = the first piece)
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('a0')] = 6;
    p.board[iccsToSq('a4')] = 7;
    p.board[iccsToSq('a6')] = -7;
    expect(dests(p, 'a0')).toContain('a6');
  });
});

describe('soldier', () => {
  it('forward only before the river', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('c3')] = 7;
    expect(dests(p, 'c3')).toEqual(['c4']);
  });
  it('sideways allowed only after crossing; never backward', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('c4')] = 7; // still on own side (rank 4)
    expect(dests(p, 'c4')).toEqual(['c5']);
    p.board[iccsToSq('c4')] = 0;
    p.board[iccsToSq('c5')] = 7; // crossed
    expect(dests(p, 'c5')).toEqual(['b5', 'c6', 'd5']);
    const q = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 b');
    q.board[iccsToSq('g5')] = -7; // black soldier on its own half... (rank 5 = black side)
    expect(dests(q, 'g5')).toEqual(['g4']);
    q.board[iccsToSq('g5')] = 0;
    q.board[iccsToSq('g4')] = -7; // crossed
    expect(dests(q, 'g4')).toEqual(['f4', 'g3', 'h4']);
  });
});

describe('palace confinement', () => {
  it('advisor stays on the 5 palace diagonals', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
    p.board[iccsToSq('d0')] = 2;
    expect(dests(p, 'd0')).toEqual(['e1']);
    p.board[iccsToSq('d0')] = 0;
    p.board[iccsToSq('e1')] = 2;
    expect(dests(p, 'e1')).toEqual(['d0', 'd2', 'f0', 'f2']);
  });
  it('general moves one orthogonal step inside the palace', () => {
    const p = Position.fromFen('3k5/9/9/9/9/9/9/9/9/5K3 w');
    expect(dests(p, 'f0')).toEqual(['e0', 'f1']);
  });
});

describe('check detection', () => {
  it('chariot check along a file', () => {
    expect(Position.fromFen('3k5/9/9/9/9/9/9/9/9/3RK4 w').inCheck(BLACK)).toBe(true);
  });
  it('cannon check needs exactly one screen', () => {
    expect(Position.fromFen('3k5/9/9/3p5/9/9/9/9/9/3CK4 w').inCheck(BLACK)).toBe(true);
    expect(Position.fromFen('3k5/9/9/9/9/9/9/9/9/3CK4 w').inCheck(BLACK)).toBe(false);
    expect(Position.fromFen('3k5/9/3p5/3p5/9/9/9/9/9/3CK4 w').inCheck(BLACK)).toBe(false);
  });
  it('horse check respects the leg', () => {
    // horse f7 hits d8?? -> use e7 knight-hop to d9: e7 -> (leg e8) -> d9
    expect(Position.fromFen('3k5/9/4N4/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(true);
    expect(Position.fromFen('3k5/4p4/4N4/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(false);
    expect(Position.fromFen('3k5/9/5N3/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(false); // f7 is not a hop from d9... (f7: 2 files, 2 ranks)
    // horse at f8 → d9 : two files over, one rank up. leg is e8.
    expect(Position.fromFen('3k5/5N3/9/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(true);
    expect(Position.fromFen('3k5/4pN3/9/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(false);
  });
  it('soldier check: directly in front, or beside once crossed', () => {
    expect(Position.fromFen('3k5/3P5/9/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(true);
    expect(Position.fromFen('3k5/4P4/9/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(false);
    expect(Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w').inCheck(BLACK)).toBe(false);
  });
  it('moving into check is illegal', () => {
    // chariot f0 covers the f-file; Red general d0 covers the d-file via the flying-general rule
    const q = Position.fromFen('4k4/9/9/9/9/9/9/9/9/3K1R3 b');
    expect(dests(q, 'e9')).not.toContain('f9'); // attacked by the chariot
    expect(dests(q, 'e9')).not.toContain('d9'); // would face the Red general
    expect(dests(q, 'e9')).toEqual(['e8']);
  });
});

describe('game end', () => {
  it('困毙 (no legal move, not in check) is a LOSS for the side to move', () => {
    const p = Position.fromFen('4k4/R8/9/9/3R1R3/9/9/9/9/3K5 b');
    expect(p.inCheck(BLACK)).toBe(false);
    expect(p.legalMoves().length).toBe(0);
    const r = p.result();
    expect(r).toEqual({ over: true, winner: RED, reason: 'stalemate' });
  });
  it('checkmate is a loss', () => {
    // double chariot ladder: black general e9, chariots on a9 and b8 … a9 checks along rank 9
    const p = Position.fromFen('R3k4/1R7/9/9/9/9/9/9/9/3K5 b');
    expect(p.inCheck(BLACK)).toBe(true);
    expect(p.legalMoves().length).toBe(0);
    expect(p.result()).toEqual({ over: true, winner: RED, reason: 'checkmate' });
  });
  it('normal positions are ongoing', () => {
    expect(Position.initial().result()).toEqual({ over: false });
  });
  it('threefold repetition is a draw', () => {
    const p = Position.initial();
    const cycle = ['b0c2', 'b9c7', 'c2b0', 'c7b9'].map(iccsToMove);
    for (let rep = 0; rep < 2; rep++) for (const m of cycle) p.makeMove(m);
    expect(p.repetitionCount()).toBe(3);
    expect(p.result()).toEqual({ over: true, winner: null, reason: 'repetition' });
  });
});

describe('notation helpers', () => {
  it('ICCS round trip', () => {
    expect(moveToIccs(iccsToMove('h2e2'))).toBe('h2e2');
  });
});
