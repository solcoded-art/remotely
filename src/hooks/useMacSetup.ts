import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplaySource, Permissions } from '@/lib/types';

export function useMacSetup() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [driverReady, setDriverReady] = useState(false);
  const [sources, setSources] = useState<DisplaySource[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const operation = useRef(false);
  const readPermissions = useCallback(async (prompt = false) => {
    try {
      const [next, info] = await Promise.all([window.macRemote!.permissions(prompt), window.macRemote!.info()]);
      if (mounted.current) { setPermissions(next); setDriverReady(info.driverReady); }
      return next;
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : 'Unable to check Mac permissions.');
      return null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void readPermissions();
    const refresh = () => { void readPermissions(); };
    window.addEventListener('focus', refresh);
    return () => { mounted.current = false; window.removeEventListener('focus', refresh); };
  }, [readPermissions]);
  async function loadSources() {
    if (operation.current) return;
    operation.current = true; setLoading(true); setError('');
    try {
      const next = await window.macRemote!.sources();
      if (mounted.current) { setSources(next); setSelected(current => next.some(source => source.id === current) ? current : ''); }
      await readPermissions();
      if (!next.length && mounted.current) setError('No displays are available. Check Screen Recording in System Settings, then refresh.');
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Unable to list displays.'); }
    finally { operation.current = false; if (mounted.current) setLoading(false); }
  }
  async function select(source: DisplaySource) {
    if (operation.current) return;
    operation.current = true; setSelecting(true); setError('');
    try {
      await window.macRemote!.selectDisplay(source.id);
      if (mounted.current) setSelected(source.id);
      await readPermissions();
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Unable to select this display.'); }
    finally { operation.current = false; if (mounted.current) setSelecting(false); }
  }
  async function checkPermissions() { setError(''); await readPermissions(true); }
  return { permissions, driverReady, sources, selected, loading, selecting, error, loadSources, select, checkPermissions };
}
