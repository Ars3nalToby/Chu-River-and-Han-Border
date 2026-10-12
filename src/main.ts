import './ui/styles.css';
import * as THREE from 'three';
import { Gfx } from './core/renderer';
import { Loop } from './core/loop';
import { Lighting, buildEnvironmentMap } from './scene/lighting';
import { Environment } from './scene/environment';
import { Board } from './scene/board';
import { loadFonts } from './core/textures';
import { createDisc, ALL_DISC_CHARS } from './pieces/disc';
import { buildWarrior } from './pieces/warrior';
import { DISC_H } from './core/constants';
import { Position, pieceSide } from './game/rules';
import { sqWorld } from './core/constants';

const params = new URLSearchParams(location.search);

async function boot() {
  const stage = document.getElementById('stage')!;
  await loadFonts('楚河漢界紅黑勝負已分召喚' + ALL_DISC_CHARS);
  const gfx = new Gfx(stage);
  gfx.setQuality((params.get('q') as 'low' | 'high' | 'ultra') || 'high');
  gfx.scene.environment = buildEnvironmentMap(gfx.renderer);
  gfx.scene.environmentIntensity = 0.55;
  const lighting = new Lighting(gfx);
  const env = new Environment(gfx);
  const board = new Board(gfx);
  gfx.scene.add(board.group);

  const pos0 = Position.initial();
  for (let sq = 0; sq < 90; sq++) {
    const pc = pos0.board[sq];
    if (!pc) continue;
    const side = pieceSide(pc);
    const d = createDisc(Math.abs(pc), side);
    sqWorld(sq, d.root.position);
    if (side === 1) d.face.rotation.y = params.has('trad') ? Math.PI : 0;
    gfx.scene.add(d.root);
  }
  if (params.get('mode') === 'warriors') {
    const only = params.has('side') ? +params.get('side')! : -1;
    for (let t = 1; t <= 7; t++) for (const side of [0, 1] as const) {
      if (only >= 0 && side !== only) continue;
      const d = createDisc(t, side);
      d.root.position.set((t - 4) * 1.15, 0.0, 6.0);
      const w = buildWarrior(t, side);
      w.root.position.set(0, DISC_H + 0.014, w.discOffsetZ);
      d.root.add(w.root);
      gfx.scene.add(d.root);
    }
  }

  const loop = new Loop();
  const cam = (params.get('cam') || '0,5,12,0,0.5,-1').split(',').map(Number);
  gfx.camera.position.set(cam[0], cam[1], cam[2]);
  gfx.camera.lookAt(cam[3], cam[4], cam[5]);
  if (params.get('fov')) { gfx.camera.fov = +params.get('fov')!; gfx.camera.updateProjectionMatrix(); }
  loop.add((f) => {
    lighting.update(f.dt, f.time);
    env.update(f.dt, f.time);
    board.update(f.dt, f.time);
    gfx.invalidateShadows();
    gfx.render();
  });
  loop.start();
  document.getElementById('loading')!.classList.add('done');
  (window as any).__gfx = gfx;
  (window as any).THREE = THREE;
}
boot();
