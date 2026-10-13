import * as THREE from 'three';

/** Board-space → world-space. Grid spacing = 1 unit. Red sits on +Z, Black on −Z. */
export const DISC_R = 0.42;
export const DISC_H = 0.16;
export const BOARD_TOP = 0;
export const GROUND_Y = -1.55;

/** half-width of the river channel (water) and of the stone banks that flank it */
export const WATER_HALF = 0.17;

export const sqX = (file: number) => file - 4;
export const sqZ = (rank: number) => 4.5 - rank;
export const sqWorld = (sq: number, out = new THREE.Vector3()): THREE.Vector3 =>
  out.set(sqX(sq % 9), BOARD_TOP, sqZ((sq / 9) | 0));

/** nearest intersection to a world point, or -1 if too far from any */
export function worldToSq(x: number, z: number, maxDist = 0.58): number {
  const f = Math.round(x + 4);
  const r = Math.round(4.5 - z);
  if (f < 0 || f > 8 || r < 0 || r > 9) return -1;
  const dx = x - sqX(f), dz = z - sqZ(r);
  if (dx * dx + dz * dz > maxDist * maxDist) return -1;
  return r * 9 + f;
}

export const COLORS = {
  lacquerRed: 0x7a1e14,
  lacquerBlack: 0x16171b,
  vermilion: 0xb3261e,
  ink: 0x121212,
  gold: 0xc9a24a,
  silver: 0x9aa0a6,
  jade: 0x4fd1a1,
  terracottaRed: 0xa65a3c,
  bronzeDark: 0x2e2a24,
  verdigris: 0x4a8f7f,
  board: 0x6b4a2e,
  stone: 0x2a2c30,
  inkLine: 0x1a140f,
};
