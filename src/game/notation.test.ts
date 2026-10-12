import { describe, it, expect } from 'vitest';
import { Position, iccsToMove } from './rules';
import { chineseNotation, wxfNotation, formatMove } from './notation';

const zh = (fen: string, iccs: string) => chineseNotation(Position.fromFen(fen), iccsToMove(iccs));
const start = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
const startB = start.replace(' w', ' b');

describe('Chinese notation', () => {
  it('canonical openings', () => {
    expect(zh(start, 'h2e2')).toBe('炮二平五');
    expect(zh(start, 'b0c2')).toBe('傌八進七');
    expect(zh(startB, 'h9g7')).toBe('馬8進7');
    expect(zh(startB, 'h7e7')).toBe('砲8平5');
    expect(zh(start, 'a0a1')).toBe('俥九進一');
    expect(zh(start, 'c0e2')).toBe('相七進五');
    expect(zh(start, 'e3e4')).toBe('兵五進一');
    expect(zh(start, 'd0e1')).toBe('仕六進五');
  });
  it('backward / horizontal chariot', () => {
    expect(zh('4k4/9/9/9/9/9/9/9/R8/4K4 w', 'a1a0')).toBe('俥九退一');
    expect(zh('4k4/9/9/9/9/9/9/9/R8/4K4 w', 'a1d1')).toBe('俥九平六');
  });
  it('front / rear disambiguation on the same file', () => {
    expect(zh('3k5/9/9/9/9/9/9/R8/R8/4K4 w', 'a2a1')).toBe('前俥退一');
    expect(zh('3k5/9/9/9/9/9/9/R8/R8/4K4 w', 'a1b1')).toBe('後俥平八');
  });
  it('WXF notation', () => {
    expect(wxfNotation(Position.fromFen(start), iccsToMove('h2e2'))).toBe('C2=5');
    expect(wxfNotation(Position.fromFen(startB), iccsToMove('h9g7'))).toBe('H8+7');
  });
  it('ICCS style passthrough', () => {
    expect(formatMove(Position.fromFen(start), iccsToMove('h2e2'), 'iccs')).toBe('h2e2');
  });
});
