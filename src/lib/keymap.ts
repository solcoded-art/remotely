/** macOS virtual key codes (US layout) for characters the on-screen keyboard can chord. */
export type Modifier = 'cmd' | 'ctrl' | 'alt' | 'shift';
export const MODIFIERS: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'cmd'];
export const MODIFIER_SYMBOL: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' };
export const MODIFIER_NAME: Record<Modifier, string> = { ctrl: 'Control', alt: 'Option', shift: 'Shift', cmd: 'Command' };

const CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28, '0': 29,
  ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43,
  '/': 44, n: 45, m: 46, '.': 47, '`': 50, ' ': 49,
};
const SHIFTED: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};

/** Named non-character keys. */
export const SPECIAL_KEYS = {
  Return: 36, Tab: 48, Space: 49, Delete: 51, Escape: 53, 'Forward delete': 117,
  Home: 115, End: 119, 'Page up': 116, 'Page down': 121,
  Left: 123, Right: 124, Down: 125, Up: 126,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
} as const;
export type SpecialKey = keyof typeof SPECIAL_KEYS;
const SPECIAL_LABEL: Partial<Record<SpecialKey, string>> = { Return: '↩', Tab: '⇥', Delete: '⌫', Escape: 'esc', Left: '←', Right: '→', Down: '↓', Up: '↑', Space: 'Space', 'Forward delete': '⌦' };

/** Key code plus whether Shift is needed to produce `char` on a US layout, or null. */
export function chordFor(char: string): { code: number; shift: boolean } | null {
  if (char.length !== 1) return null;
  const lower = char.toLowerCase();
  if (lower !== char && CODES[lower] !== undefined) return { code: CODES[lower], shift: true };
  if (CODES[char] !== undefined) return { code: CODES[char], shift: false };
  if (SHIFTED[char]) return { code: CODES[SHIFTED[char]], shift: true };
  return null;
}

/** A key a hotkey can press: a single printable US character or a named key. */
export function keyCode(key: string): number | null {
  if (key in SPECIAL_KEYS) return SPECIAL_KEYS[key as SpecialKey];
  return chordFor(key.toLowerCase())?.code ?? null;
}

export type Hotkey = { id: string; label: string; key: string; modifiers: Modifier[] };

export function hotkeyCombo(hotkey: Pick<Hotkey, 'key' | 'modifiers'>) {
  const mods = MODIFIERS.filter(mod => hotkey.modifiers.includes(mod)).map(mod => MODIFIER_SYMBOL[mod]).join('');
  const key = SPECIAL_LABEL[hotkey.key as SpecialKey] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
  return `${mods}${mods ? ' ' : ''}${key}`;
}

export function hotkeySpoken(hotkey: Pick<Hotkey, 'key' | 'modifiers'>) {
  return [...MODIFIERS.filter(mod => hotkey.modifiers.includes(mod)).map(mod => MODIFIER_NAME[mod]), hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key].join(' ');
}

export const DEFAULT_HOTKEYS: Hotkey[] = [
  { id: 'select-all', label: 'Select all', key: 'a', modifiers: ['cmd'] },
  { id: 'spotlight', label: 'Spotlight', key: 'Space', modifiers: ['cmd'] },
  { id: 'switch-app', label: 'Switch app', key: 'Tab', modifiers: ['cmd'] },
  { id: 'prev-app', label: 'Previous app', key: 'Tab', modifiers: ['cmd', 'shift'] },
  { id: 'copy', label: 'Copy', key: 'c', modifiers: ['cmd'] },
  { id: 'paste', label: 'Paste', key: 'v', modifiers: ['cmd'] },
  { id: 'cut', label: 'Cut', key: 'x', modifiers: ['cmd'] },
  { id: 'undo', label: 'Undo', key: 'z', modifiers: ['cmd'] },
  { id: 'redo', label: 'Redo', key: 'z', modifiers: ['cmd', 'shift'] },
  { id: 'save', label: 'Save', key: 's', modifiers: ['cmd'] },
  { id: 'find', label: 'Find', key: 'f', modifiers: ['cmd'] },
  { id: 'new-tab', label: 'New tab', key: 't', modifiers: ['cmd'] },
  { id: 'close', label: 'Close', key: 'w', modifiers: ['cmd'] },
  { id: 'next-tab', label: 'Next tab', key: 'Tab', modifiers: ['ctrl'] },
  { id: 'prev-tab', label: 'Previous tab', key: 'Tab', modifiers: ['ctrl', 'shift'] },
  { id: 'shift-tab', label: 'Focus back', key: 'Tab', modifiers: ['shift'] },
  { id: 'mac-fullscreen', label: 'Mac fullscreen', key: 'f', modifiers: ['ctrl', 'cmd'] },
  { id: 'shift-return', label: 'New line', key: 'Return', modifiers: ['shift'] },
];

/** Validates a hotkey read from storage. */
export function isHotkey(value: unknown): value is Hotkey {
  if (!value || typeof value !== 'object') return false;
  const item = value as Hotkey;
  return typeof item.id === 'string' && typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 40
    && typeof item.key === 'string' && keyCode(item.key) !== null
    && Array.isArray(item.modifiers) && item.modifiers.length <= 4 && item.modifiers.every(mod => MODIFIERS.includes(mod));
}
