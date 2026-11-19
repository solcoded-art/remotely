import { useCallback, useEffect, useRef, useState } from 'react';
import { accountServer } from '@/lib/auth-session';

export interface MacUpdate {
  current: string;
  latest: string;
  /** The server marks this version as no longer supported. */
  required: boolean;
  service: string;
}

const CHECK_EVERY = 6 * 60 * 60 * 1000;
const FOCUS_RECHECK_AFTER = 30 * 60 * 1000;

function parse(version: unknown) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
}
export function isNewerVersion(candidate: unknown, current: unknown) {
  const a = parse(candidate); const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * Mac app only: compares this build's version with the release the account
 * service publishes at /api/downloads/mac. Returns null on the web, on iOS,
 * when up to date, or when the check fails (it retries later, silently).
 */
export function useMacUpdate(): MacUpdate | null {
  const [update, setUpdate] = useState<MacUpdate | null>(null);
  const lastCheck = useRef(0);
  const latestRequest = useRef(0);

  const check = useCallback(async () => {
    const mac = window.macRemote;
    if (!mac) return;
    lastCheck.current = Date.now();
    const request = ++latestRequest.current;
    try {
      const service = accountServer();
      const [info, response] = await Promise.all([
        mac.info(),
        fetch(service + '/api/downloads/mac', { signal: AbortSignal.timeout(8000) }),
      ]);
      if (!response.ok || !info.version) return;
      const release = await response.json() as { version?: string; available?: boolean; minimumSupportedVersion?: string };
      if (request !== latestRequest.current) return; // a newer check already started
      if (release.available !== true || !isNewerVersion(release.version, info.version)) { setUpdate(null); return; }
      setUpdate({
        current: info.version,
        latest: release.version!,
        required: isNewerVersion(release.minimumSupportedVersion, info.version),
        service,
      });
    } catch { /* offline or service unavailable: try again on the next interval */ }
  }, []);

  useEffect(() => {
    if (!window.macRemote) return;
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY);
    const onFocus = () => { if (Date.now() - lastCheck.current > FOCUS_RECHECK_AFTER) void check(); };
    // `remotely:check-updates` forces a check (e.g. a future "Check for updates" menu item).
    const onRequest = () => void check();
    window.addEventListener('focus', onFocus);
    window.addEventListener('remotely:check-updates', onRequest);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('remotely:check-updates', onRequest); };
  }, [check]);

  return update;
}
