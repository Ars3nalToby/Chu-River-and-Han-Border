// Browser fuzz test for the choreography layer. Needs: npm i -D playwright-core, a running dev server (npm run dev)
// and a Chromium (set CHROME=/path/to/chrome). Plays random games with animations fast-forwarded and checks after
// every move that the 3D piece map matches the rules engine's board. Usage: GAMES=6 PLIES=120 node scripts/browser-fuzz.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 400 } })).newPage();
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0,160)}`); });
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://localhost:5173/?q=low&guard=0&fast=1&slow=1&ai=0', { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
const games = +process.env.GAMES || 2, plies = +process.env.PLIES || 70;
for (let g = 0; g < games; g++) {
  const res = await p.evaluate(async ({ plies, g }) => {
    const G = window.__game; const api = G.api();
    G.settings.cinematic = (g % 2 === 0);      // exercise both camera paths
    G.sched.speed = 60; G.loop.maxDt = 0.5; G.gfx.render = () => {};    // fast-forward every tween
    api.game.newGame();
    let seed = 1234 + g * 77; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const caps = {}; const issues = [];
    const check = (tag) => {
      const pos = api.state.pos;
      for (let sq = 0; sq < 90; sq++) {
        const pc = pos.board[sq]; const v = api.pieces.get(sq);
        if (!pc && v) issues.push(`${tag}: ghost view at ${sq}`);
        else if (pc && !v) issues.push(`${tag}: missing view at ${sq}`);
        else if (pc && v && (v.type !== Math.abs(pc) || v.side !== (pc > 0 ? 0 : 1) || v.sq !== sq)) issues.push(`${tag}: mismatch at ${sq}`);
      }
    };
    let n = 0;
    for (; n < plies; n++) {
      if (G.gameOver) break;
      const moves = api.state.pos.legalMoves();
      if (!moves.length) break;
      // prefer captures 40% of the time so every capture style gets exercised
      const capsList = moves.filter((m) => api.state.pos.board[m >> 7]);
      const m = (capsList.length && rnd() < 0.5) ? capsList[Math.floor(rnd() * capsList.length)] : moves[Math.floor(rnd() * moves.length)];
      const from = m & 127, to = m >> 7;
      const type = Math.abs(api.state.pos.board[from]); const cap = !!api.state.pos.board[to];
      if (cap) caps[type] = (caps[type] || 0) + 1;
      const iccs = String.fromCharCode(97 + from % 9) + Math.floor(from / 9) + String.fromCharCode(97 + to % 9) + Math.floor(to / 9);
      await api.play(iccs);
      // let trailing tweens (tray hop, camera restore) finish
      await new Promise((r) => setTimeout(r, 60));
      check(`g${g} ply${n} ${iccs}`);
      if (issues.length > 5) break;
    }
    return { game: g, plies: n, over: G.gameOver, captures: caps, issues: issues.slice(0, 8), live: api.pieces.size };
  }, { plies, g });
  console.log(JSON.stringify(res));
}
console.log(logs.slice(0, 15).join('\n') || 'no console errors/warnings');
await b.close();
