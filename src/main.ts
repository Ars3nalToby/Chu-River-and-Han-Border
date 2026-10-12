import './ui/styles.css';
import { Game } from './game/game';

async function boot() {
  const stage = document.getElementById('stage')!;
  const game = new Game(stage);
  (window as unknown as { __game?: Game }).__game = game;
  try {
    await game.init((p, line) => {
      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      const l = document.getElementById('loading-line');
      if (l) l.textContent = line;
    });
  } catch (e) {
    console.error(e);
    const l = document.getElementById('loading-line');
    if (l) l.textContent = String(e);
  }
}
void boot();
