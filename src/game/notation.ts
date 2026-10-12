import {
  Position, Move, moveFrom, moveTo, fileOf, rankOf, pieceSide, PT, RED, sqToIccs, sqOf, moveToIccs,
} from './rules';

export type NotationStyle = 'zh' | 'wxf' | 'iccs';

const ZH_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RED_NAMES: Record<number, string> = { 1: '帥', 2: '仕', 3: '相', 4: '傌', 5: '俥', 6: '炮', 7: '兵' };
const BLACK_NAMES: Record<number, string> = { 1: '將', 2: '士', 3: '象', 4: '馬', 5: '車', 6: '砲', 7: '卒' };
const WXF_LETTERS: Record<number, string> = { 1: 'K', 2: 'A', 3: 'E', 4: 'H', 5: 'R', 6: 'C', 7: 'P' };

export const pieceName = (pc: number): string => (pc > 0 ? RED_NAMES[pc] : BLACK_NAMES[-pc]);

/** file number as written in notation: counted from the mover's right-hand side */
const fileNo = (side: number, file: number) => (side === RED ? 9 - file : file + 1);

interface Analysis {
  side: number;
  type: PT;
  pc: number;
  fromNo: number;
  action: '進' | '退' | '平';
  dest: number;
  /** 'front' prefix label index among same-file twins, or null */
  twinIndex: number;
  twinCount: number;
  multiFileSoldiers: boolean;
}

function analyse(pos: Position, m: Move): Analysis {
  const from = moveFrom(m);
  const to = moveTo(m);
  const pc = pos.board[from];
  const side = pieceSide(pc);
  const type = Math.abs(pc) as PT;
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const f1 = fileOf(to);
  const r1 = rankOf(to);
  const fwd = side === RED ? 1 : -1;
  const action: '進' | '退' | '平' = r1 === r0 ? '平' : (r1 - r0) * fwd > 0 ? '進' : '退';
  const diagonalMover = type === PT.Horse || type === PT.Elephant || type === PT.Advisor;
  const dest = action === '平' || diagonalMover ? fileNo(side, f1) : Math.abs(r1 - r0);

  // same-type friendly pieces on the same file (ordered front → back)
  const twins: number[] = [];
  for (let r = 0; r < 10; r++) if (pos.board[sqOf(f0, r)] === pc) twins.push(r);
  twins.sort((a, b) => (b - a) * fwd);
  // Soldiers: count files that contain ≥2 soldiers (affects disambiguation)
  let multi = 0;
  if (type === PT.Soldier) {
    for (let f = 0; f < 9; f++) {
      let n = 0;
      for (let r = 0; r < 10; r++) if (pos.board[sqOf(f, r)] === pc) n++;
      if (n >= 2) multi++;
    }
  }
  return {
    side, type, pc, fromNo: fileNo(side, f0), action, dest,
    twinIndex: twins.indexOf(r0), twinCount: twins.length, multiFileSoldiers: multi > 1,
  };
}

function numeral(side: number, n: number): string {
  return side === RED ? ZH_NUM[n] : String(n);
}

function twinLabelZh(index: number, count: number): string {
  if (count === 2) return index === 0 ? '前' : '後';
  if (count === 3) return ['前', '中', '後'][index];
  // 4–5 soldiers
  if (index === 0) return '前';
  if (index === count - 1) return '後';
  return ZH_NUM[index + 1];
}

/** Standard Chinese notation, e.g. 炮二平五 / 馬8進7 / 前俥退一 */
export function chineseNotation(pos: Position, m: Move): string {
  const a = analyse(pos, m);
  const name = pieceName(a.pc);
  const tail = a.action + numeral(a.side, a.dest);
  if (a.twinCount >= 2) {
    const label = twinLabelZh(a.twinIndex, a.twinCount);
    // Two doubled soldier files at once: name the file too so the move stays unambiguous
    // (non-standard but lossless; the official convention leaves this case to context).
    if (a.type === PT.Soldier && a.multiFileSoldiers) return label + name + numeral(a.side, a.fromNo) + tail;
    return label + name + tail;
  }
  return name + numeral(a.side, a.fromNo) + tail;
}

/** WXF notation, e.g. C2=5, H8+7, +R-1 */
export function wxfNotation(pos: Position, m: Move): string {
  const a = analyse(pos, m);
  const op = a.action === '進' ? '+' : a.action === '退' ? '-' : '=';
  const letter = WXF_LETTERS[a.type];
  if (a.twinCount >= 2) {
    const label = a.twinIndex === 0 ? '+' : a.twinIndex === a.twinCount - 1 ? '-' : String(a.twinIndex + 1);
    const base = label + letter + op + a.dest;
    return a.type === PT.Soldier && a.multiFileSoldiers ? letter + a.fromNo + op + a.dest : base;
  }
  return letter + a.fromNo + op + a.dest;
}

export function formatMove(pos: Position, m: Move, style: NotationStyle): string {
  if (style === 'iccs') return moveToIccs(m);
  return style === 'zh' ? chineseNotation(pos, m) : wxfNotation(pos, m);
}

export { sqToIccs };
