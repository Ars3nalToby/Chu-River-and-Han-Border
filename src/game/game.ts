import * as THREE from 'three';
import { Gfx, Quality } from '../core/renderer';
import { Loop } from '../core/loop';
import { Scheduler } from '../core/tween';
import { Lighting, buildEnvironmentMap } from '../scene/lighting';
import { Environment } from '../scene/environment';
import { Board } from '../scene/board';
import { Trays } from '../scene/trays';
import { Highlights } from '../fx/highlights';
import { ParticleFx } from '../fx/particles';
import { ShatterFx } from '../fx/shatter';
import { CannonFx } from '../fx/cannonShell';
import { CameraRig, CamPreset } from '../camera/rig';
import { Sfx } from '../audio/sfx';
import { PieceView } from '../pieces/pieceView';
import { ALL_DISC_CHARS, pruneFaceCache, setDiscTextureSize } from '../pieces/disc';
import { loadFonts } from '../core/textures';
import { GameState, MoveRecord } from './state';
import {
  Position, Move, Side, PT, RED, BLACK, mkMove, moveFrom, moveTo, fileOf, rankOf, iccsToMove, pieceSide, sqToIccs,
} from './rules';
import { Choreographer } from './choreographer';
import { AiClient } from './aiClient';
import { Hud } from '../ui/hud';
import { Settings, loadSettings, saveSettings } from '../ui/settings';
import { dict, setLang, t } from '../ui/i18n';
import { worldToSq } from '../core/constants';
import { warriorProviderReady } from '../pieces/provider';

const pieceType = (pc: number) => Math.abs(pc) as PT;

export class Game {
  readonly gfx: Gfx;
  readonly loop = new Loop();
  readonly sched = new Scheduler();
  readonly sfx = new Sfx();
  settings: Settings;
  private lighting!: Lighting;
  private env!: Environment;
  private board!: Board;
  private trays!: Trays;
  private highlights!: Highlights;
  private fx!: ParticleFx;
  private shatter!: ShatterFx;
  private cannon!: CannonFx;
  private rig!: CameraRig;
  private hud!: Hud;
  private choreo!: Choreographer;
  private ai = new AiClient();
  private state = new GameState();
  private pieces = new Map<number, PieceView>();
  private piecesGroup = new THREE.Group();
  private humanSide: Side = RED;
  private selected = -1;
  private targets = new Set<number>();
  private busy = false;
  private thinking = false;
  private gameOver = false;
  private replaying = false;
  private replayAbort = false;
  private aiToken = 0;
  private baseScale = 1;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private down: { x: number; y: number; t: number } | null = null;
  private lowFpsSamples = 0;
  private lastShadow = 0;
  private sessionT = 0;

  constructor(private container: HTMLElement) {
    this.settings = loadSettings();
    const q = new URLSearchParams(location.search);
    if (q.get('q')) this.settings.quality = q.get('q') as Quality;
    if (q.get('lang')) this.settings.lang = q.get('lang') as 'zh' | 'en';
    if (q.has('classic')) this.settings.classic = q.get('classic') !== '0';
    if (q.has('ai')) this.settings.vsAi = q.get('ai') !== '0';
    if (q.has('slow')) this.loop.maxDt = 0.5;
    setLang(this.settings.lang);
    this.gfx = new Gfx(container);
  }

  /* ─────────────────────────── boot ─────────────────────────── */

  async init(onProgress: (p: number, line: string) => void): Promise<void> {
    const lines = dict().loadingLines;
    const step = async (p: number, i: number) => {
      onProgress(p, lines[i % lines.length]);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    };
    await step(0.05, 0);
    await loadFonts('楚河漢界紅黑勝負已分將軍帥仕相傌俥炮兵士象馬車砲卒棋譜設置' + ALL_DISC_CHARS);
    const g = this.gfx;
    g.setQuality(this.settings.quality);
    setDiscTextureSize(this.settings.quality === 'low' ? 512 : 1024);
    g.scene.environment = buildEnvironmentMap(g.renderer);
    g.scene.environmentIntensity = 0.5;
    await step(0.15, 5);
    this.lighting = new Lighting(g);
    this.env = new Environment(g);
    await step(0.3, 6);
    this.board = new Board(g);
    g.scene.add(this.board.group);
    this.trays = new Trays(this.sched);
    g.scene.add(this.trays.group);
    await step(0.42, 7);

    this.highlights = new Highlights(g);
    g.scene.add(this.highlights.group);
    this.fx = new ParticleFx();
    g.scene.add(this.fx.group);
    this.shatter = new ShatterFx(this.fx);
    g.scene.add(this.shatter.group);
    this.cannon = new CannonFx(this.fx, this.sched, this.lighting);
    g.scene.add(this.cannon.group);
    g.scene.add(this.piecesGroup);

    this.rig = new CameraRig(g.camera, g.canvas, this.sched);
    this.choreo = new Choreographer({
      sched: this.sched, loop: this.loop, lighting: this.lighting, fx: this.fx, shatter: this.shatter, cannon: this.cannon,
      trays: this.trays, rig: this.rig, sfx: this.sfx, settings: () => this.settings, baseTimeScale: () => this.baseScale,
      humanSide: () => this.humanSide,
      onCinematic: (on) => document.getElementById('ui')?.classList.toggle('cine', on),
    });

    await warriorProviderReady(); // Track A: look for /models/*.glb, else procedural
    await step(0.55, 0);
    // build the army with progress lines
    this.buildPieces(Position.initial());
    await step(0.85, 2);

    this.hud = new Hud(document.getElementById('ui')!, {
      onNewGame: () => this.newGame(),
      onUndo: () => this.undo(),
      onAiMove: () => this.aiAssist(),
      onToggleSide: () => this.toggleSide(),
      onCamera: (p) => this.setCamera(p),
      onSettings: (s, k) => this.applySetting(s, k),
      onReplay: () => this.replay(),
      onStopReplay: () => this.stopReplay(),
      onDismissEnd: () => this.hud.hideEnd(),
      onMute: (m) => this.sfx.setMuted(m),
    }, this.settings);
    this.sfx.muted = this.settings.muted;
    this.hud.setTurn(RED, false);
    this.hud.setHumanSide(this.humanSide);
    this.hud.setMoves([]);
    this.hud.setCamera('player');

    this.bindInput();
    this.bindLoop();
    this.applyFaceYaw();
    await step(1, 4);
    this.loop.start();
    this.hud.finishLoading();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // first user gesture unlocks audio
    const unlock = () => {
      this.sfx.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.entrance();
  }

  /** pieces rise out of the board one after another */
  private entrance(): void {
    if (new URLSearchParams(location.search).has('fast')) return;
    const list = [...this.pieces.values()];
    list.forEach((p, i) => {
      const y0 = -0.6;
      p.root.position.y = y0;
      void this.sched.wait(0.05 + i * 0.03).then(() =>
        this.sched.tween(0.5, (u) => (p.root.position.y = y0 * (1 - (1 - Math.pow(1 - u, 3)))), (u) => u),
      );
    });
  }

  private bindLoop() {
    const g = this.gfx;
    this.loop.add((f) => {
      this.sessionT += f.rawDt;
      this.sched.update(f.dt, f.rawDt);
      for (const p of this.pieces.values()) p.update(f.dt);
      this.lighting.update(f.dt, f.time);
      this.env.update(f.dt, f.time);
      this.board.update(f.dt, f.time);
      this.highlights.update(f.dt, f.time);
      this.fx.update(f.dt);
      this.shatter.update(f.dt);
      this.cannon.update(f.dt);
      this.rig.update(f.rawDt);
      // particle point sizes follow the render height / fov
      const h = g.renderer.domElement.height;
      this.fx.setScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov) / 2)));
      // shadow map: every frame while things move, ~7 Hz when idle
      if (this.sched.busy || this.loop.timeScale !== 1 || f.rawTime - this.lastShadow > 0.14) {
        g.invalidateShadows();
        this.lastShadow = f.rawTime;
      }
      g.render();
    });
    // auto-drop to Low if the average FPS stays under 45 for 3 s
    this.loop.onFps = (fps) => {
      if (this.sessionT < 5 || document.hidden || g.quality.name === 'low') {
        this.lowFpsSamples = 0;
        return;
      }
      this.lowFpsSamples = fps < 45 ? this.lowFpsSamples + 1 : 0;
      if (this.lowFpsSamples >= 6) {
        this.lowFpsSamples = 0;
        this.settings.quality = 'low';
        this.settings.autoLowered = true;
        g.setQuality('low');
        this.hud.toast(t('perf'), 'info');
      }
    };
  }

  /* ─────────────────────────── pieces ─────────────────────────── */

  private yawForSide(side: Side): number {
    if (this.settings.faceOwn) return side === RED ? 0 : Math.PI;
    return this.humanSide === RED ? 0 : Math.PI;
  }

  private applyFaceYaw() {
    for (const p of this.pieces.values()) p.setFaceYaw(this.yawForSide(p.side));
    this.pruneFaces();
  }

  private pruneFaces() {
    pruneFaceCache(new Set([...this.pieces.values()].map((p) => p.faceKey)));
  }

  private buildPieces(pos: Position) {
    for (const p of this.pieces.values()) p.dispose();
    this.pieces.clear();
    for (let sq = 0; sq < 90; sq++) {
      const pc = pos.board[sq];
      if (!pc) continue;
      const f = fileOf(sq), r = rankOf(sq);
      const phase = ((f * 5 + r * 3) % 16) * 0.11; // desynced idle start
      const v = new PieceView(pieceType(pc), pieceSide(pc), sq, phase);
      v.setClassic(this.settings.classic);
      v.setFaceYaw(this.yawForSide(v.side));
      this.piecesGroup.add(v.root);
      this.pieces.set(sq, v);
    }
  }

  /* ─────────────────────────── input ─────────────────────────── */

  private bindInput() {
    const el = this.gfx.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
      this.onTap(e.clientX, e.clientY);
    });
    window.addEventListener('resize', () => {
      this.gfx.resize();
      this.rig?.onAspectChange();
    });
  }

  private onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null;
    if (tgt && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tgt.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'h') this.hud.toggleHidden();
    else if (k === 'escape') {
      if (this.hud.settingsOpen) this.hud.closeSettings();
      else {
        this.deselect();
        this.hud.hideEnd();
      }
    }
  }

  /** pick: piece hit proxies first, then the board plane */
  private pick(cx: number, cy: number): { pieceSq: number; planeSq: number } {
    const rect = this.gfx.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.gfx.camera);
    const hits: THREE.Object3D[] = [];
    for (const p of this.pieces.values()) hits.push(...p.hitObjects);
    const inter = this.raycaster.intersectObjects(hits, false);
    let pieceSq = -1;
    if (inter.length) {
      const id = inter[0].object.userData.pieceId as number;
      for (const p of this.pieces.values()) if (p.id === id) pieceSq = p.sq;
    }
    const pt = new THREE.Vector3();
    let planeSq = -1;
    if (this.raycaster.ray.intersectPlane(this.plane, pt)) planeSq = worldToSq(pt.x, pt.z, 0.52);
    return { pieceSq, planeSq };
  }

  private onTap(cx: number, cy: number) {
    if (this.busy || this.gameOver || this.thinking || this.replaying) return;
    if (!this.controls(this.state.turn)) return;
    const { pieceSq, planeSq } = this.pick(cx, cy);
    const own = (sq: number) => sq >= 0 && this.state.pos.board[sq] !== 0 && pieceSide(this.state.pos.board[sq]) === this.state.turn;

    if (this.selected >= 0) {
      let dest = -1;
      if (planeSq >= 0 && this.targets.has(planeSq)) dest = planeSq;
      else if (pieceSq >= 0 && this.targets.has(pieceSq)) dest = pieceSq;
      if (dest >= 0) {
        void this.humanMove(mkMove(this.selected, dest));
        return;
      }
      // switch selection to another own piece
      const again = own(pieceSq) ? pieceSq : own(planeSq) ? planeSq : -1;
      if (again >= 0 && again !== this.selected) {
        this.select(again);
        return;
      }
      // illegal destination → teach why
      const tapped = planeSq >= 0 ? planeSq : pieceSq;
      if (tapped >= 0 && tapped !== this.selected) this.explainIllegal(this.selected, tapped);
      this.deselect();
      return;
    }
    const s = own(pieceSq) ? pieceSq : own(planeSq) ? planeSq : -1;
    if (s >= 0) this.select(s);
  }

  /* ─────────────────────────── selection + rule teaching ─────────────────────────── */

  private select(sq: number) {
    this.deselect(false);
    const pos = this.state.pos;
    const legal = pos.legalMoves(sq);
    this.selected = sq;
    this.targets = new Set(legal.map(moveTo));
    this.highlights.select(sq);
    this.highlights.setTargets(legal.map((m) => ({ sq: moveTo(m), capture: pos.board[moveTo(m)] !== 0 })));
    this.sfx.uiTone('select');
    this.sfx.woodClick(0.5);
    const view = this.pieces.get(sq);
    if (view) {
      const y0 = view.root.position.y;
      void this.sched.tween(0.18, (u) => { if (this.selected === sq) view.root.position.y = y0 + 0.07 * u; });
    }
    const type = pieceType(pos.board[sq]);
    if (type === PT.Elephant) this.board.river.setBarrier(true);
    // teach: flash a tiny warning glyph on whatever blocks a horse leg / elephant eye
    if (type === PT.Horse || type === PT.Elephant) {
      const seen = new Set<number>();
      for (const b of pos.blockedMoves(sq)) {
        if (seen.has(b.blocker)) continue;
        seen.add(b.blocker);
        const zh = this.settings.lang === 'zh';
        this.highlights.warn(b.blocker, b.kind === 'horse-leg' ? (zh ? '蹩' : 'leg') : (zh ? '塞' : 'eye'), false, 1.8, 0.5);
      }
    }
  }

  private deselect(clearAll = true) {
    if (this.selected >= 0) {
      const view = this.pieces.get(this.selected);
      if (view) {
        const y0 = view.root.position.y;
        void this.sched.tween(0.15, (u) => { view.root.position.y = y0 * (1 - u); });
      }
    }
    this.selected = -1;
    this.targets.clear();
    this.board?.river.setBarrier(false);
    if (clearAll) this.highlights.clear();
  }

  /** the tapped intersection is not legal: say why (and teach the rule visually) */
  private explainIllegal(from: number, to: number) {
    const pos = this.state.pos;
    const pc = pos.board[from];
    const type = pieceType(pc);
    const zh = this.settings.lang === 'zh';
    const blocked = pos.blockedMoves(from).find((b) => b.to === to);
    if (blocked) {
      this.highlights.warn(blocked.blocker, blocked.kind === 'horse-leg' ? t('warnHorse') : t('warnElephant'), !zh, 2.0, zh ? 0.95 : 1.5);
      this.hud.toast(blocked.kind === 'horse-leg' ? t('horseLegHint') : t('elephantEyeHint'));
      this.sfx.uiTone('error');
      return;
    }
    if (type === PT.Elephant) {
      const df = Math.abs(fileOf(to) - fileOf(from)), dr = Math.abs(rankOf(to) - rankOf(from));
      if (df === 2 && dr === 2) {
        this.hud.toast(t('warnRiver'));
        this.sfx.uiTone('error');
        return;
      }
    }
    // pseudo-legal but leaves the general exposed?
    const pseudo: Move[] = [];
    pos.genPseudo(pseudo, from);
    if (pseudo.includes(mkMove(from, to))) {
      pos.makeMove(mkMove(from, to));
      const kr = pos.kingSq;
      const facing = fileOf(kr[0]) === fileOf(kr[1]) && this.openFile(pos, fileOf(kr[0]), rankOf(kr[0]), rankOf(kr[1]));
      pos.unmakeMove();
      this.hud.toast(facing ? t('warnFlying') : t('warnCheck'));
      this.sfx.uiTone('error');
    }
  }

  private openFile(pos: Position, file: number, r0: number, r1: number): boolean {
    for (let r = Math.min(r0, r1) + 1; r < Math.max(r0, r1); r++) if (pos.board[r * 9 + file]) return false;
    return true;
  }

  /* ─────────────────────────── move execution ─────────────────────────── */

  private async humanMove(m: Move) {
    this.deselect();
    await this.playMove(m);
    this.afterMove();
  }

  /** animate + commit a legal move on the current state */
  private async playMove(m: Move): Promise<MoveRecord> {
    this.busy = true;
    this.hud.setBusy(true);
    this.highlights.clearLastMove();
    this.board.setCheckGlow(0, false);
    this.board.setCheckGlow(1, false);
    const pos = this.state.pos;
    const from = moveFrom(m), to = moveTo(m);
    const moverPc = pos.board[from], victimPc = pos.board[to];
    const type = pieceType(moverPc);
    const screenSq = type === PT.Cannon && victimPc ? pos.cannonScreen(from, to) : -1;
    const rec = this.state.play(m);

    const mover = this.pieces.get(from)!;
    const victim = victimPc ? this.pieces.get(to) ?? null : null;
    const screen = screenSq >= 0 ? this.pieces.get(screenSq) ?? null : null;
    this.pieces.delete(from);
    if (victim) this.pieces.delete(to);

    if (!victim) await this.choreo.normalMove(mover, from, to);
    else if (type === PT.Cannon) await this.choreo.cannonCapture(mover, victim, from, to, screenSq, screen);
    else await this.choreo.meleeCapture(mover, victim, from, to);

    mover.setSquare(to);
    this.pieces.set(to, mover);
    if (victim) void this.choreo.toTray(rec.side, pieceType(victimPc), pieceSide(victimPc));
    this.highlights.showLastMove(from, to);
    this.hud.setMoves(this.state.records);
    return rec;
  }

  private async afterMove() {
    const res = this.state.result();
    const rec = this.state.records[this.state.records.length - 1];
    if (res.over) {
      await this.endGame(res);
      this.busy = false;
      this.hud.setBusy(false);
      this.hud.setTurn(this.state.turn, false);
      return;
    }
    if (rec?.gaveCheck) {
      await this.checkSequence(this.state.turn);
    }
    this.busy = false;
    this.hud.setBusy(false);
    this.hud.setTurn(this.state.turn, false);
    this.sfx.uiTone('move');
    void this.maybeAiMove();
  }

  private async checkSequence(inCheck: Side) {
    this.board.setCheckGlow(inCheck, true);
    this.sfx.warDrum(1);
    this.hud.showCheck(() => {
      this.sfx.thud(1);
      this.rig.shake(0.035, 0.25);
    });
    await this.sched.wait(0.9, true);
  }

  private async endGame(res: Extract<ReturnType<Position['result']>, { over: true }>) {
    this.gameOver = true;
    this.selected = -1;
    this.highlights.clear();
    if (res.winner === null) {
      this.sfx.uiTone('lose');
      await this.sched.wait(0.6, true);
      this.hud.showEnd({ kind: 'draw' });
      return;
    }
    const loser = (1 - res.winner) as Side;
    const kingSq = this.state.pos.kingSq[loser];
    this.board.setCheckGlow(loser, true);
    if (res.reason === 'checkmate') {
      this.sfx.warDrum(1);
      this.hud.showCheck();
      await this.sched.wait(0.7, true);
    }
    const gv = this.pieces.get(kingSq);
    if (gv) await this.choreo.fall(gv);
    this.sfx.uiTone(res.winner === this.humanSide ? 'win' : 'lose');
    await this.sched.wait(0.35, true);
    if (!this.replaying) this.hud.showEnd({ kind: 'win', winner: res.winner, reason: res.reason });
  }

  /* ─────────────────────────── AI ─────────────────────────── */

  /** may the person at the screen move for this side? (always, in two-player mode) */
  private controls(side: Side): boolean {
    return !this.settings.vsAi || side === this.humanSide;
  }

  private async maybeAiMove(force = false) {
    if (this.gameOver || this.busy || this.thinking || this.replaying) return;
    if (!force && (!this.settings.vsAi || this.state.turn === this.humanSide)) return;
    const token = ++this.aiToken;
    this.thinking = true;
    this.hud.setTurn(this.state.turn, true);
    const t0 = performance.now();
    const moves = this.state.records.map((r) => r.iccs);
    const reply = await this.ai.think(moves, this.settings.level);
    // deliberate thinking delay so it never moves instantly
    const wait = Math.max(0, 750 + Math.random() * 450 - (performance.now() - t0));
    await this.sched.wait(wait / 1000, true);
    if (token !== this.aiToken) return; // cancelled (undo / new game)
    this.thinking = false;
    if (!reply.move) {
      this.hud.setTurn(this.state.turn, false);
      return;
    }
    const m = iccsToMove(reply.move);
    if (!this.state.pos.isLegal(m)) {
      this.hud.setTurn(this.state.turn, false);
      return;
    }
    await this.playMove(m);
    await this.afterMove();
  }

  private aiAssist() {
    if (this.busy || this.gameOver || this.thinking || this.replaying) return;
    this.deselect();
    void this.maybeAiMove(true);
  }

  /* ─────────────────────────── controls ─────────────────────────── */

  private resetVisualState() {
    this.aiToken++;
    this.ai.cancel();
    this.thinking = false;
    this.deselect();
    this.sched.cancelAll();
    this.highlights.clearLastMove();
    this.board.setCheckGlow(0, false);
    this.board.setCheckGlow(1, false);
    this.shatter.clear();
    this.loop.timeScale = this.baseScale;
  }

  newGame() {
    if (this.busy && !this.gameOver) return;
    this.resetVisualState();
    this.hud.hideEnd();
    this.gameOver = false;
    this.busy = false;
    this.state.reset();
    this.trays.clear();
    this.buildPieces(this.state.pos);
    this.hud.setMoves([]);
    this.hud.setTurn(RED, false);
    this.entrance();
    this.sfx.uiTone('confirm');
    this.setCamera('player');
    void this.maybeAiMove();
  }

  private rebuildFromState() {
    this.buildPieces(this.state.pos);
    this.trays.setContents(
      this.state.records.filter((r) => r.captured).map((r) => ({ captor: r.side, type: pieceType(r.captured), side: pieceSide(r.captured) })),
    );
    const last = this.state.records[this.state.records.length - 1];
    if (last) this.highlights.showLastMove(moveFrom(last.move), moveTo(last.move));
    this.hud.setMoves(this.state.records);
    this.hud.setTurn(this.state.turn, false);
  }

  undo() {
    if (this.busy || this.replaying || !this.state.records.length) return;
    this.resetVisualState();
    this.hud.hideEnd();
    this.gameOver = false;
    // undo back to the human's turn: remove the AI reply (if any) and the human's own move
    let n = 1;
    if (this.settings.vsAi && this.state.turn === this.humanSide && this.state.records.length >= 2) n = 2;
    else n = 1;
    this.state.undo(Math.min(n, this.state.records.length));
    this.rebuildFromState();
    this.sfx.uiTone('select');
    void this.maybeAiMove();
  }

  toggleSide() {
    if (this.busy || this.replaying) return;
    this.resetVisualState();
    this.humanSide = (1 - this.humanSide) as Side;
    this.hud.setHumanSide(this.humanSide);
    this.rig.setFlipped(this.humanSide === BLACK);
    this.applyFaceYaw();
    this.hud.toast(this.humanSide === RED ? t('youAreRed') : t('youAreBlack'), 'info');
    this.sfx.uiTone('confirm');
    void this.maybeAiMove();
  }

  private setCamera(p: CamPreset) {
    this.hud.setCamera(p);
    void this.rig.goPreset(p);
  }

  private applySetting(s: Settings, key: keyof Settings) {
    this.settings = s;
    saveSettings(s);
    switch (key) {
      case 'lang':
        setLang(s.lang);
        break;
      case 'quality':
        this.gfx.setQuality(s.quality);
        break;
      case 'classic':
        for (const p of this.pieces.values()) p.setClassic(s.classic);
        this.pruneFaces();
        break;
      case 'faceOwn':
        this.applyFaceYaw();
        break;
      case 'vsAi':
        this.aiToken++;
        this.thinking = false;
        this.hud.setTurn(this.state.turn, false);
        if (s.vsAi) void this.maybeAiMove();
        break;
      default:
        break;
    }
  }

  /* ─────────────────────────── replay ─────────────────────────── */

  async replay() {
    if (this.replaying || !this.state.records.length) return;
    this.replaying = true;
    this.replayAbort = false;
    this.hud.hideEnd();
    this.hud.setReplaying(true);
    const saved = this.state;
    const recs = saved.records.slice();
    this.resetVisualState();
    this.state = new GameState();
    this.trays.clear();
    this.buildPieces(this.state.pos);
    this.hud.setMoves([]);
    this.baseScale = 1.35;
    this.loop.timeScale = this.baseScale;
    this.gameOver = false;
    await this.sched.wait(0.6, true);
    for (const r of recs) {
      if (this.replayAbort) break;
      this.hud.setTurn(this.state.turn, false);
      await this.playMove(r.move);
      const rec = this.state.records[this.state.records.length - 1];
      if (this.replayAbort) break;
      if (rec.gaveCheck && !this.state.result().over) await this.checkSequence(this.state.turn);
      if (this.state.result().over) {
        const res = this.state.result();
        if (res.over) await this.endGame(res);
      }
      await this.sched.wait(0.25, true);
    }
    // restore the real game
    this.sched.speed = 1;
    this.baseScale = 1;
    this.loop.timeScale = 1;
    this.resetVisualState();
    this.state = saved;
    this.gameOver = this.state.result().over;
    this.rebuildFromState();
    this.replaying = false;
    this.busy = false;
    this.hud.setReplaying(false);
    this.hud.setBusy(false);
    if (this.gameOver) {
      const res = this.state.result();
      if (res.over) {
        const loser = res.winner === null ? null : ((1 - res.winner) as Side);
        if (loser !== null) {
          this.board.setCheckGlow(loser, true);
          this.hud.showEnd({ kind: 'win', winner: res.winner as Side, reason: res.reason as 'checkmate' | 'stalemate' });
        } else this.hud.showEnd({ kind: 'draw' });
      }
    }
  }

  stopReplay() {
    this.replayAbort = true;
    this.sched.speed = 8; // finish the in-flight move quickly
  }

  /* ─────────────────────────── debug / test hooks ─────────────────────────── */

  /** debug: replace the position (clears history) */
  loadFen(fen: string) {
    this.resetVisualState();
    this.gameOver = false;
    this.busy = false;
    this.state.reset();
    this.state.pos = Position.fromFen(fen);
    this.trays.clear();
    this.buildPieces(this.state.pos);
    this.hud.setMoves([]);
    this.hud.setTurn(this.state.turn, false);
    this.hud.hideEnd();
  }

  /** exposed on window.__game for automated tests and screenshots */
  api() {
    return {
      state: this.state,
      pieces: this.pieces,
      play: (iccs: string) => this.playMove(iccsToMove(iccs)).then(() => this.afterMove()),
      select: (iccs: string) => this.select(iccsToSqSafe(iccs)),
      camera: (p: CamPreset) => this.setCamera(p),
      rig: this.rig,
      gfx: this.gfx,
      hud: this.hud,
      choreo: this.choreo,
      sched: this.sched,
      loop: this.loop,
      game: this,
      project: (iccs: string, y = 0.3) => {
        const sq = iccsToSqSafe(iccs);
        const v = new THREE.Vector3((sq % 9) - 4, y, 4.5 - Math.floor(sq / 9)).project(this.gfx.camera);
        const r = this.gfx.canvas.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      loadFen: (f: string) => this.loadFen(f),
      board: this.board,
      setQuality: (q: Quality) => this.applySetting({ ...this.settings, quality: q }, 'quality'),
    };
  }
}

function iccsToSqSafe(s: string): number {
  return (s.charCodeAt(0) - 97) + (+s[1]) * 9;
}

void sqToIccs;
void pieceSide;
