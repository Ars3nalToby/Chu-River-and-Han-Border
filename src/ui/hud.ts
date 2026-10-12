import type { MoveRecord } from '../game/state';
import type { Side } from '../game/rules';
import type { CamPreset } from '../camera/rig';
import { dict, setLang, t } from './i18n';
import type { Settings } from './settings';
import type { Quality } from '../core/renderer';
import type { Level } from '../game/ai';
import type { NotationStyle } from '../game/notation';
import { SealStamp } from '../fx/sealStamp';

export interface HudHandlers {
  onNewGame(): void;
  onUndo(): void;
  onAiMove(): void;
  onToggleSide(): void;
  onCamera(p: CamPreset): void;
  onSettings(s: Settings, changed: keyof Settings): void;
  onReplay(): void;
  onStopReplay(): void;
  onDismissEnd(): void;
  onMute(m: boolean): void;
}

type El = HTMLElement;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export type EndKind = { kind: 'win'; winner: Side; reason: 'checkmate' | 'stalemate' } | { kind: 'draw' };

export class Hud {
  readonly stamp: SealStamp;
  private root: El;
  private turn: Side = 0;
  private thinking = false;
  private moves: MoveRecord[] = [];
  private camActive: CamPreset = 'player';
  private humanSide: Side = 0;
  private panelCollapsed = false;
  private toolbarOpen = false;
  private replaying = false;
  private end: EndKind | null = null;
  private muted = false;
  private busy = false;
  // live element refs (replaced on rebuild)
  private refs: Record<string, El> = {};
  private settingsModal!: El;
  private endLayer!: El;
  private toastWrap!: El;
  private listEl!: El;

  constructor(root: HTMLElement, private handlers: HudHandlers, public settings: Settings) {
    this.root = root;
    setLang(settings.lang);
    this.muted = settings.muted;
    this.panelCollapsed = window.matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape)').matches;
    this.stamp = new SealStamp(document.body);
    this.rebuild();
  }

  /* ---------------- state setters ---------------- */

  setTurn(side: Side, thinking: boolean) {
    this.turn = side;
    this.thinking = thinking;
    this.updateTurn();
  }
  setMoves(m: MoveRecord[]) {
    this.moves = m;
    this.renderMoves();
  }
  setCamera(p: CamPreset) {
    this.camActive = p;
    for (const [k, el] of Object.entries(this.refs)) if (k.startsWith('cam-')) el.classList.toggle('active', k === 'cam-' + p);
  }
  setHumanSide(s: Side) {
    this.humanSide = s;
    if (this.refs.side) this.refs.side.textContent = s === 0 ? t('playBlack') : t('playRed');
  }
  setBusy(b: boolean) {
    this.busy = b;
    ['undo', 'newgame', 'side', 'ai'].forEach((k) => this.refs[k]?.toggleAttribute('disabled', false));
    void b;
  }
  setReplaying(on: boolean) {
    this.replaying = on;
    this.refs.replayBar?.classList.toggle('hide', !on);
  }

  toast(msg: string, kind: 'warn' | 'info' = 'warn') {
    const el = h('div', 'toast' + (kind === 'info' ? ' info' : ''), msg);
    this.toastWrap.appendChild(el);
    window.setTimeout(() => el.remove(), 2700);
    while (this.toastWrap.children.length > 3) this.toastWrap.firstElementChild?.remove();
  }

  toggleHidden(force?: boolean) {
    this.root.classList.toggle('hidden', force);
  }
  get hidden() {
    return this.root.classList.contains('hidden');
  }

  setLoading(progress: number, line?: string) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    const l = document.getElementById('loading-line');
    if (l && line) l.textContent = line;
  }
  finishLoading() {
    document.getElementById('loading')?.classList.add('done');
  }

  /* ---------------- check stamp / end scroll ---------------- */

  showCheck(impact?: () => void) {
    const zh = this.settings.lang === 'zh';
    this.stamp.show(zh ? '將軍' : t('check'), { latin: !zh, impact });
  }

  showEnd(e: EndKind) {
    this.end = e;
    this.renderEnd();
    this.endLayer.classList.add('show');
  }
  hideEnd() {
    this.endLayer.classList.remove('show');
  }
  get endVisible() {
    return this.endLayer?.classList.contains('show');
  }
  get endResult() {
    return this.end;
  }

  openSettings() {
    this.renderSettings();
    this.settingsModal.classList.add('show');
  }

  /* ---------------- construction ---------------- */

  private rebuild() {
    this.root.innerHTML = '';
    this.refs = {};
    const hideable = h('div', 'hide-able');
    hideable.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.root.appendChild(hideable);

    /* pill */
    const pill = h('div', 'pill');
    pill.append(h('span', 'title', t('title')), h('span', 'sep'));
    const turn = h('div', 'turn');
    const dot = h('span', 'dot red');
    const label = h('span', 'label');
    turn.append(dot, label, h('span', 'spin'));
    pill.append(turn);
    this.refs.pill = pill;
    this.refs.dot = dot;
    this.refs.turnLabel = label;
    hideable.appendChild(pill);

    /* toolbar */
    const bar = h('div', 'toolbar' + (this.toolbarOpen ? ' open' : ''));
    const handle = h('div', 'sheet-handle');
    bar.appendChild(handle);
    handle.addEventListener('click', () => this.toggleSheet(bar));
    // phones: the whole top strip of the sheet is a tap target
    bar.addEventListener('click', (e) => {
      if (!window.matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape)').matches) return;
      const r = bar.getBoundingClientRect();
      const inStrip = (e as MouseEvent).clientY - r.top < 30;
      if (!this.toolbarOpen || inStrip) {
        if (e.target === bar || e.target === handle) this.toggleSheet(bar);
      }
    });
    const mk = (key: string, label: string, onClick: () => void, cls = '') => {
      const b = h('button', 'btn ' + cls, label);
      b.addEventListener('click', () => { this.maybeCloseSheet(bar); onClick(); });
      this.refs[key] = b;
      return b;
    };
    const g1 = h('div', 'group');
    g1.append(
      mk('side', this.humanSide === 0 ? t('playBlack') : t('playRed'), () => this.handlers.onToggleSide()),
      mk('ai', t('aiMove'), () => this.handlers.onAiMove()),
      mk('newgame', t('newGame'), () => this.handlers.onNewGame()),
      mk('undo', t('undo'), () => this.handlers.onUndo()),
    );
    const g2 = h('div', 'group');
    const cams: [CamPreset, Parameters<typeof t>[0]][] = [['player', 'camPlayer'], ['overhead', 'camOverhead'], ['side', 'camSide'], ['battlefield', 'camBattlefield']];
    for (const [p, k] of cams) g2.appendChild(mk('cam-' + p, t(k), () => this.handlers.onCamera(p), p === this.camActive ? 'active' : ''));
    const g3 = h('div', 'group');
    g3.append(
      mk('hide', t('hideUi'), () => this.toggleHidden(true)),
      mk('settings', t('settings'), () => this.openSettings()),
      mk('movesBtn', t('moves'), () => {
        const p = this.refs.panel;
        const open = !p.classList.contains('open-mobile');
        p.classList.toggle('open-mobile', open);
        p.classList.toggle('collapsed', !open);
        this.panelCollapsed = !open;
      }, 'mobile-only'),
      mk('mute', this.muted ? '🔇' : '🔊', () => {
        this.muted = !this.muted;
        this.settings.muted = this.muted;
        this.refs.mute.textContent = this.muted ? '🔇' : '🔊';
        this.handlers.onMute(this.muted);
        this.handlers.onSettings(this.settings, 'muted');
      }, 'icon'),
    );
    bar.append(g1, g2, g3);
    hideable.appendChild(bar);
    this.refs.toolbar = bar;

    /* replay bar */
    const rb = h('div', 'group hide' );
    rb.style.cssText = 'position:absolute;left:50%;top:14px;transform:translateX(-50%);pointer-events:auto';
    rb.append(h('span', '', t('replaying')), mk('stopReplay', t('stopReplay'), () => this.handlers.onStopReplay()));
    rb.firstChild!.textContent = t('replaying');
    (rb.firstChild as HTMLElement).style.cssText = 'padding:0 10px;color:var(--gold)';
    rb.classList.toggle('hide', !this.replaying);
    if (!document.getElementById('hud-hide-style')) {
      const st = document.createElement('style');
      st.id = 'hud-hide-style';
      st.textContent = '.hide{display:none!important}';
      document.head.appendChild(st);
    }
    this.refs.replayBar = rb;
    hideable.appendChild(rb);

    /* move list */
    const panel = h('div', 'movepanel' + (this.panelCollapsed ? ' collapsed' : ' open-mobile'));
    const header = h('header');
    const title = h('h3', '', t('moves'));
    const sel = h('select');
    for (const [v, k] of [['zh', 'nZh'], ['wxf', 'nWxf'], ['iccs', 'nIccs']] as [NotationStyle, Parameters<typeof t>[0]][]) {
      const o = h('option', '', t(k), { value: v });
      if (this.settings.notation === v) o.setAttribute('selected', '');
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      this.settings.notation = sel.value as NotationStyle;
      this.renderMoves();
      this.handlers.onSettings(this.settings, 'notation');
    });
    const collapse = h('button', 'btn icon', this.panelCollapsed ? '▾' : '▴');
    collapse.addEventListener('click', () => {
      this.panelCollapsed = !this.panelCollapsed;
      panel.classList.toggle('collapsed', this.panelCollapsed);
      panel.classList.toggle('open-mobile', !this.panelCollapsed);
      collapse.textContent = this.panelCollapsed ? '▾' : '▴';
    });
    header.append(title, sel, collapse);
    this.listEl = h('div', 'list');
    panel.append(header, this.listEl);
    hideable.appendChild(panel);
    this.refs.panel = panel;

    /* toasts + hints */
    this.toastWrap = h('div', 'toast-wrap');
    hideable.appendChild(this.toastWrap);
    hideable.appendChild(h('div', 'hint-bar', dict().controls));
    this.root.appendChild(h('div', 'show-hint', t('showUiHint')));

    /* end scroll */
    this.endLayer = h('div', 'scroll-layer');
    this.root.parentElement?.querySelectorAll('.scroll-layer').forEach((n) => n.remove());
    document.body.appendChild(this.endLayer);

    /* settings modal */
    this.settingsModal = h('div', 'modal');
    this.root.parentElement?.querySelectorAll('.modal').forEach((n) => n.remove());
    document.body.appendChild(this.settingsModal);
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.settingsModal.classList.remove('show');
    });

    this.updateTurn();
    this.renderMoves();
    this.setCamera(this.camActive);
    if (this.end) this.renderEnd();
  }

  private toggleSheet(bar: El) {
    this.toolbarOpen = !this.toolbarOpen;
    bar.classList.toggle('open', this.toolbarOpen);
  }
  private maybeCloseSheet(bar: El) {
    if (window.matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape)').matches) {
      this.toolbarOpen = false;
      bar.classList.remove('open');
    }
  }

  private updateTurn() {
    if (!this.refs.dot) return;
    this.refs.dot.className = 'dot ' + (this.turn === 0 ? 'red' : 'black');
    this.refs.turnLabel.textContent = this.turn === 0 ? t('turnRed') : t('turnBlack');
    this.refs.pill.classList.toggle('thinking', this.thinking);
    if (this.thinking) this.refs.turnLabel.textContent += ' · ' + t('thinking');
  }

  private renderMoves() {
    const list = this.listEl;
    if (!list) return;
    list.innerHTML = '';
    if (!this.moves.length) {
      list.appendChild(h('div', 'empty', t('movesEmpty')));
      return;
    }
    const style = this.settings.notation;
    const rows = Math.ceil(this.moves.length / 2);
    for (let i = 0; i < rows; i++) {
      const r = h('div', 'row');
      r.appendChild(h('span', 'n', String(i + 1)));
      for (let k = 0; k < 2; k++) {
        const rec = this.moves[i * 2 + k];
        const cell = h('span', 'm ' + (k === 0 ? 'red' : 'black') + (i * 2 + k === this.moves.length - 1 ? ' last' : ''), rec ? rec[style] : '');
        r.appendChild(cell);
      }
      list.appendChild(r);
    }
    list.scrollTop = list.scrollHeight;
  }

  private renderEnd() {
    const e = this.end!;
    const layer = this.endLayer;
    const wasShown = layer.classList.contains('show');
    layer.innerHTML = '';
    layer.classList.toggle('show', wasShown);
    const scroll = h('div', 'scroll');
    scroll.append(h('div', 'rod'));
    const wrap = h('div', 'paper-wrap');
    const paper = h('div', 'paper');
    const d = dict();
    const verdict = h('div', 'verdict ' + (e.kind === 'draw' ? 'draw' : e.winner === 0 ? 'red' : 'black'), e.kind === 'draw' ? d.draw : e.winner === 0 ? d.redWins : d.blackWins);
    paper.append(verdict, h('div', 'sub', e.kind === 'draw' ? d.drawSub : d.endSub));
    if (e.kind === 'win') paper.append(h('div', 'reason', e.reason === 'checkmate' ? d.reasonCheckmate : d.reasonStalemate));
    paper.append(h('div', 'seal-mini', e.kind === 'draw' ? '和' : e.winner === 0 ? '紅' : '黑'));
    wrap.appendChild(paper);
    scroll.append(wrap, h('div', 'rod'));
    const actions = h('div', 'scroll-actions');
    const b1 = h('button', 'btn', t('replay'));
    const b2 = h('button', 'btn', t('newGame'));
    const b3 = h('button', 'btn', t('dismiss'));
    b1.addEventListener('click', () => this.handlers.onReplay());
    b2.addEventListener('click', () => this.handlers.onNewGame());
    b3.addEventListener('click', () => this.handlers.onDismissEnd());
    actions.append(b1, b2, b3);
    paper.append(actions);
    layer.appendChild(scroll);
  }

  private renderSettings() {
    const m = this.settingsModal;
    m.innerHTML = '';
    const sheet = h('div', 'sheet');
    sheet.appendChild(h('h2', '', t('settings')));
    const S = this.settings;

    const seg = <T extends string>(label: string, options: [T, string][], value: T, onPick: (v: T) => void) => {
      const f = h('div', 'field');
      f.appendChild(h('label', '', label));
      const s = h('div', 'seg');
      for (const [v, text] of options) {
        const b = h('button', 'btn' + (v === value ? ' active' : ''), text);
        b.addEventListener('click', () => {
          onPick(v);
          this.renderSettings();
        });
        s.appendChild(b);
      }
      f.appendChild(s);
      sheet.appendChild(f);
    };
    const toggle = (label: string, value: boolean, onPick: (v: boolean) => void) => {
      const f = h('div', 'field');
      f.appendChild(h('label', '', label));
      const sw = h('div', 'switch' + (value ? ' on' : ''));
      sw.addEventListener('click', () => {
        onPick(!value);
        this.renderSettings();
      });
      f.appendChild(sw);
      sheet.appendChild(f);
    };

    seg(t('language'), [['zh', '中文'], ['en', 'English']], S.lang, (v) => {
      S.lang = v;
      setLang(v);
      this.handlers.onSettings(S, 'lang');
      this.rebuild();
      this.settingsModal.classList.add('show');
      this.renderSettings();
    });
    seg<Level>(t('difficulty'), [['recruit', t('lvRecruit')], ['captain', t('lvCaptain')], ['general', t('lvGeneral')], ['master', t('lvMaster')]], S.level, (v) => {
      S.level = v;
      this.handlers.onSettings(S, 'level');
    });
    seg<Quality>(t('quality'), [['low', t('qLow')], ['high', t('qHigh')], ['ultra', t('qUltra')]], S.quality, (v) => {
      S.quality = v;
      this.handlers.onSettings(S, 'quality');
    });
    toggle(t('vsAi'), S.vsAi, (v) => { S.vsAi = v; this.handlers.onSettings(S, 'vsAi'); });
    toggle(t('classic'), S.classic, (v) => { S.classic = v; this.handlers.onSettings(S, 'classic'); });
    toggle(t('cinematic'), S.cinematic, (v) => { S.cinematic = v; this.handlers.onSettings(S, 'cinematic'); });
    toggle(t('faceOwn'), S.faceOwn, (v) => { S.faceOwn = v; this.handlers.onSettings(S, 'faceOwn'); });
    toggle(t('sound') + ' · ' + (S.muted ? t('unmute') : t('mute')), !S.muted, (v) => {
      S.muted = !v;
      this.muted = S.muted;
      if (this.refs.mute) this.refs.mute.textContent = this.muted ? '🔇' : '🔊';
      this.handlers.onMute(S.muted);
      this.handlers.onSettings(S, 'muted');
    });
    const foot = h('div', 'foot');
    foot.append(h('span', '', dict().controls));
    const close = h('button', 'btn active', t('close'));
    close.addEventListener('click', () => m.classList.remove('show'));
    foot.appendChild(close);
    sheet.appendChild(foot);
    m.appendChild(sheet);
  }
}
