import { useSyncExternalStore } from 'react';

/** Apps the dock offers to open when they are not running. Must match the Mac's launch allowlist. */
export const LAUNCHERS = [
  { name: 'VS Code', bundleId: 'com.microsoft.VSCode' },
  { name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92' },
  { name: 'Zed', bundleId: 'dev.zed.Zed' },
  { name: 'Terminal', bundleId: 'com.apple.Terminal' },
  { name: 'Safari', bundleId: 'com.apple.Safari' },
] as const;

/**
 * Real app icons sent by the Mac, cached on this phone by bundle id.
 * Only small PNG data URLs are accepted; nothing here is sent to the account service.
 */
const KEY = 'remotely.app-icons';
const LIMIT = 80;
const VALID = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function load(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string' && VALID.test(value) && value.length <= 32768)) as Record<string, string>;
  } catch { /* storage unavailable */ }
  return {};
}

let icons = load();
const listeners = new Set<() => void>();

export const appIcons = {
  get: () => icons,
  has: (bundleId: string) => bundleId in icons,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** Stores an icon from the Mac. Returns false for anything that is not a small PNG data URL. */
  set(bundleId: string, icon: unknown) {
    if (!bundleId || typeof icon !== 'string' || icon.length > 32768 || !VALID.test(icon)) return false;
    const entries = Object.entries({ ...icons, [bundleId]: icon });
    icons = Object.fromEntries(entries.slice(-LIMIT));
    try { localStorage.setItem(KEY, JSON.stringify(icons)); } catch { /* keep in memory only */ }
    listeners.forEach(listener => listener());
    return true;
  },
};

export function useAppIcons() { return useSyncExternalStore(appIcons.subscribe, appIcons.get); }
