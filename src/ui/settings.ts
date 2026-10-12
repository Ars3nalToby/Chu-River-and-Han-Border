import type { Lang } from './i18n';
import type { Quality } from '../core/renderer';
import type { Level } from '../game/ai';
import type { NotationStyle } from '../game/notation';

export interface Settings {
  lang: Lang;
  quality: Quality;
  level: Level;
  classic: boolean;
  cinematic: boolean;
  notation: NotationStyle;
  /** true = each side's characters face their owner (traditional); false = all upright for the viewer */
  faceOwn: boolean;
  muted: boolean;
  /** play against the AI (false = two players on one screen) */
  vsAi: boolean;
  /** quality was auto-lowered by the FPS guard */
  autoLowered: boolean;
}

const KEY = 'chuhan-xiangqi-settings-v1';

export const DEFAULTS: Settings = {
  lang: (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)) ? 'zh' : 'en',
  quality: 'high',
  level: 'captain',
  classic: false,
  cinematic: true,
  notation: 'zh',
  faceOwn: false,
  muted: false,
  vsAi: true,
  autoLowered: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), autoLowered: false };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}
