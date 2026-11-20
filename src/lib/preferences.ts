import { useSyncExternalStore } from 'react';
import { DEFAULT_HOTKEYS, isHotkey, type Hotkey } from './keymap';

/** Per-device remote control preferences. Stored locally; never sent to the account service. */
export type Preferences = { trackpadSpeed: number; hotkeys: Hotkey[] };

const SPEED_KEY = 'macremote.sensitivity';
const HOTKEYS_KEY = 'macremote.hotkeys';
export const SPEED_RANGE = { min: 0.5, max: 3, step: 0.1, fallback: 1.4 } as const;

function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }

function load(): Preferences {
  const speed = Number(read(SPEED_KEY));
  let hotkeys = DEFAULT_HOTKEYS;
  try {
    const saved = JSON.parse(read(HOTKEYS_KEY) || 'null');
    if (Array.isArray(saved)) hotkeys = saved.filter(isHotkey).slice(0, 48);
  } catch { /* keep defaults */ }
  return { trackpadSpeed: Number.isFinite(speed) && speed >= SPEED_RANGE.min && speed <= SPEED_RANGE.max ? speed : SPEED_RANGE.fallback, hotkeys };
}

let state = load();
const listeners = new Set<() => void>();
function set(next: Partial<Preferences>) { state = { ...state, ...next }; listeners.forEach(listener => listener()); }

export const preferences = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  setTrackpadSpeed(value: number) {
    const speed = Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, Math.round(value * 10) / 10));
    write(SPEED_KEY, String(speed)); set({ trackpadSpeed: speed });
  },
  setHotkeys(hotkeys: Hotkey[]) { write(HOTKEYS_KEY, JSON.stringify(hotkeys)); set({ hotkeys }); },
  addHotkey(hotkey: Omit<Hotkey, 'id'>) {
    const item = { ...hotkey, label: hotkey.label.trim(), id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
    if (!isHotkey(item)) return false;
    preferences.setHotkeys([...state.hotkeys, item]); return true;
  },
  removeHotkey(id: string) { preferences.setHotkeys(state.hotkeys.filter(item => item.id !== id)); },
  resetHotkeys() { preferences.setHotkeys(DEFAULT_HOTKEYS); },
};

export function usePreferences() { return useSyncExternalStore(preferences.subscribe, preferences.get); }
