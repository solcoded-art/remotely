const { execFileSync, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { version, build } = require('../package.json');

function verify(app) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--all-architectures', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--strict', path.join(app, 'Contents/Resources/mac_driver')], { stdio: 'inherit' });
  const plist = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  assert.equal(plist('CFBundleIdentifier'), build.appId);
  assert.equal(plist('CFBundleShortVersionString'), version);
  assert.equal(plist('LSMinimumSystemVersion'), '13.0');
  for (const relative of ['Contents/MacOS/Mac Remote', 'Contents/Resources/mac_driver']) {
    assert.equal(execFileSync('lipo', ['-archs', path.join(app, relative)], { encoding: 'utf8' }).trim(), 'arm64');
  }
}
if (process.platform !== 'darwin') throw Error('Mac signature verification requires macOS.');
const app = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'release/mac-arm64/Mac Remote.app');
verify(app);
if (process.argv.includes('--tamper-check')) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-remote-signature-'));
  try {
    const modified = path.join(stage, 'Modified.app');
    execFileSync('ditto', [app, modified]);
    fs.appendFileSync(path.join(modified, 'Contents/Resources/app.asar'), Buffer.from([0]));
    const result = spawnSync('codesign', ['--verify', '--deep', '--strict', modified], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.notEqual(result.status, null, 'Signature check did not complete.');
    assert.notEqual(result.status, 0, 'Modified app resources unexpectedly passed verification.');
    console.log('Tamper check passed: a modified app resource is rejected.');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
console.log('Bundle/helper integrity verified; Developer ID trust and notarization are not established.');
