import type { BrowserContext } from '@playwright/test';

export async function installMacFixture(context: BrowserContext, overrides: { permissions?: { accessibility: boolean; screen: string }; driverReady?: boolean } = {}) {
  await context.addInitScript((overrides) => {
    const fixture = { permissions: { accessibility: true, screen: 'granted' }, driverReady: true, ...overrides };
    (window as any).macTest = fixture;
    const listeners = new Set<(value: unknown) => void>();
    (window as any).commands = [];
    const identities = new Map<string, { keys: CryptoKeyPair; pins: Record<string, unknown> }>();
    async function identity(scope: string) {
      if (!identities.has(scope)) identities.set(scope, { keys: await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']), pins: {} });
      return identities.get(scope)!;
    }
    (window as any).macRemote = {
      identity: async (scope: string) => crypto.subtle.exportKey('jwk', (await identity(scope)).keys.publicKey),
      sign: async (scope: string, message: string) => {
        const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (await identity(scope)).keys.privateKey, new TextEncoder().encode(message));
        return btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      },
      pins: async (scope: string) => ({ ...(await identity(scope)).pins }),
      pin: async (scope: string, id: string, value: unknown) => { const record = await identity(scope); if (value) record.pins[id] = value; else delete record.pins[id]; },
      platform: 'mac', info: async () => ({ name: 'Test Mac', driverReady: fixture.driverReady }),
      permissions: async () => fixture.permissions,
      sources: async () => [{ id: 'screen:1', displayId: '1', name: 'Main display', thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="225"><rect width="360" height="225" fill="%23272d30"/></svg>' }],
      selectDisplay: async () => {}, approve: async () => {}, end: async () => {},
      command: async (_id: string, value: any) => {
        (window as any).commands.push(value);
        if (value.action === 'listApps') listeners.forEach(listener => listener({ action: 'listApps', apps: [{ pid: 123, name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode', active: true }, { pid: 124, name: 'Safari', bundleId: 'com.apple.Safari', active: false }] }));
      },
      onDriver: (listener: (value: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = '#1b2024'; ctx.fillRect(0, 0, 1280, 800); ctx.fillStyle = '#a5e2bd'; ctx.font = '28px monospace'; ctx.fillText('Synthetic desktop · WebRTC integration test', 50, 80); ctx.fillText(new Date().toISOString(), 50, 135); };
      paint(); const timer = setInterval(paint, 100); const stream = canvas.captureStream(10);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    } });
  }, overrides);
}
