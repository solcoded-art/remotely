const { createDisplayCaptureHandler } = require('./display-capture.cjs');
const { safeStorage } = require('electron');
const { createAuthSessionStore } = require('./auth-session.cjs');
const { createIdentityStore } = require('./identity.cjs');
const { app, BrowserWindow, ipcMain, protocol, net, session, desktopCapturer, systemPreferences, shell, Notification } = require('electron');
const { downloadPageURL, parseVersion } = require('./updates.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { validateCommand } = require('../shared/commands.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let window;
let driver;
let approvedSession = null;
let selectedSource = null;
let driverReady = false;

function write(command) {
  if (!driverReady || !driver?.stdin.writable) throw Error('The input driver is unavailable. Restart the companion.');
  if (command.action !== 'releaseAll' && driver.stdin.writableLength > 65536) throw Error('Input queue is busy.');
  driver.stdin.write(JSON.stringify(command) + '\n');
}
function release() {
  approvedSession = null;
  if (driverReady) { try { write({ action: 'releaseAll' }); } catch {} }
}
function localOnly(event) {
  if (event.sender !== window?.webContents || !event.senderFrame?.url.startsWith('app://macremote/')) throw Error('Untrusted sender.');
}
function handle(name, fn) { ipcMain.handle(`remote:${name}`, (event, ...args) => { localOnly(event); return fn(...args); }); }

app.whenReady().then(async () => {
  const authSession = createAuthSessionStore(path.join(app.getPath('userData'), 'auth-sessions'), safeStorage);
  handle('auth-session', authSession);
  const dist = path.resolve(__dirname, '../dist');
  protocol.handle('app', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'macremote') return new Response('Forbidden', { status: 403 });
    let relative;
    try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
    const target = path.resolve(dist, '.' + (relative === '/' ? '/index.html' : relative));
    if (!target.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; frame-ancestors 'none'; frame-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'");
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'mac_driver') : path.resolve(__dirname, '../bin/mac_driver');
  if (!fs.existsSync(binary)) throw Error('Compile the input driver with npm run build:driver.');
  driver = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  driver.once('spawn', () => { driverReady = true; });
  let buffer = '';
  driver.stdout.setEncoding('utf8');
  driver.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { window?.webContents.send('remote:driver', JSON.parse(line)); } catch {}
    }
  });
  driver.on('error', error => { driverReady = false; release(); window?.webContents.send('remote:driver', { action: 'error', message: error.message }); });
  driver.on('exit', () => { driverReady = false; release(); window?.webContents.send('remote:driver', { action: 'error', message: 'Input driver stopped. Restart the companion.' }); });
  driver.stdin.on('error', () => { driverReady = false; release(); });
  driver.stderr.on('data', data => console.error('[driver]', data.toString()));

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents === window?.webContents && webContents.getURL().startsWith('app://macremote/') && approvedSession !== null && ['display-capture', 'media'].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(createDisplayCaptureHandler(
    () => ({ sessionId: approvedSession, sourceId: selectedSource?.id, frame: window?.webContents.mainFrame }),
    () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
  ));
  const identities = createIdentityStore(path.join(app.getPath('userData'), 'device-keys'), safeStorage);
  handle('identity', scope => identities.identity(scope));
  handle('sign', (scope, message) => identities.sign(scope, message));
  handle('pins', scope => identities.pins(scope));
  handle('pin', (scope, id, pin) => identities.pin(scope, id, pin));
  handle('info', () => ({ name: os.hostname(), driverReady, version: app.getVersion() }));
  // Update prompts: open only the account service's fixed download page, and
  // show at most one native notification per newer version.
  handle('open-update', async service => { await shell.openExternal(downloadPageURL(service)); });
  const notifiedVersions = new Set();
  handle('notify-update', (service, version) => {
    const url = downloadPageURL(service);
    if (!parseVersion(version)) throw Error('Invalid version.');
    if (notifiedVersions.has(version) || !Notification.isSupported()) return false;
    notifiedVersions.add(version);
    const notice = new Notification({ title: 'Remotely update available', body: `Version ${version} is ready to download.` });
    notice.on('click', () => { void shell.openExternal(url); });
    notice.show();
    return true;
  });
  handle('sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 360, height: 225 } });
    return sources.map(source => ({ id: source.id, name: source.name, displayId: source.display_id, thumbnail: source.thumbnail.toDataURL() }));
  });
  handle('select-display', async id => {
    if (approvedSession) throw Error('End the current session before changing displays.');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find(source => source.id === id && /^\d+$/.test(source.display_id));
    if (!source) throw Error('Display is no longer available.');
    selectedSource = { id: source.id, displayId: Number(source.display_id) };
    write({ action: 'setDisplay', displayId: selectedSource.displayId });
  });
  handle('approve', id => {
    if (typeof id !== 'string' || !/^[\w-]{8,80}$/.test(id) || approvedSession) throw Error('Invalid session.');
    if (!selectedSource) throw Error('Select a display first.');
    if (!systemPreferences.isTrustedAccessibilityClient(false)) throw Error('Enable Accessibility for Mac Remote in System Settings.');
    if (!driverReady) throw Error('Input driver is unavailable.');
    approvedSession = id;
  });
  handle('end', release);
  handle('command', (sessionId, data) => {
    if (!approvedSession || sessionId !== approvedSession) throw Error('This session has not been approved.');
    write(validateCommand(data));
  });
  handle('permissions', prompt => ({ accessibility: systemPreferences.isTrustedAccessibilityClient(prompt === true), screen: systemPreferences.getMediaAccessStatus('screen') }));

  window = new BrowserWindow({ width: 1180, height: 820, minWidth: 620, minHeight: 580, backgroundColor: '#0a0a0c', title: 'Mac Remote', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', release);
  window.webContents.on('did-start-loading', release);
  window.on('closed', () => { release(); window = null; });
  await window.loadURL('app://macremote/');
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { release(); driver?.stdin.end(); });
