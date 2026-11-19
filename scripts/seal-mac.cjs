// Seal development bundles inside-out. Never add entitlements or change runtime policy.
const { execFileSync, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../package.json');
const app = path.resolve(process.argv[2] || 'release/mac-arm64/Mac Remote.app');
const magic = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

function metadata(file) {
  const display = spawnSync('codesign', ['-d', '--verbose=4', file], { encoding: 'utf8' });
  if (display.error) throw display.error;
  assert.equal(display.status, 0, `Cannot read existing signature: ${file}`);
  assert.match(display.stderr, /Signature=adhoc/, 'This tool only seals existing ad-hoc development signatures; it must not replace a Developer ID signature.');
  const match = display.stderr.match(/flags=0x([0-9a-f]+)/i);
  assert(match, 'Existing code signature flags are missing.');
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // codesign replaces the linker-only signature with a resource-sealed signature.
  return { flags: parseInt(match[1], 16) & ~0x20000, entitlements };
}
function collect(folder, binaries, bundles) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collect(file, binaries, bundles);
      if (/\.(app|framework|xpc)$/.test(entry.name)) bundles.push(file);
    } else if (entry.isFile()) {
      const handle = fs.openSync(file, 'r');
      const header = Buffer.alloc(4);
      try { fs.readSync(handle, header, 0, 4, 0); } finally { fs.closeSync(handle); }
      if (magic.has(header.toString('hex'))) binaries.push(file);
    }
  }
}
if (process.platform !== 'darwin') throw Error('Development bundle sealing requires macOS.');
const identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
assert.equal(identifier, build.appId, 'Refusing to seal a different application.');
const binaries = [], bundles = [];
collect(app, binaries, bundles);
const insideOut = (a, b) => b.split(path.sep).length - a.split(path.sep).length;
const targets = [...binaries.sort(insideOut), ...bundles.sort(insideOut), app];
const before = new Map(targets.map(file => [file, metadata(file)]));
for (const file of targets) {
  execFileSync('codesign', ['--force', '--sign', '-', '--preserve-metadata=flags,entitlements', file], { stdio: ['ignore', 'pipe', 'pipe'] });
}
for (const file of targets) assert.deepEqual(metadata(file), before.get(file), `Runtime flags or entitlements changed: ${file}`);
execFileSync('codesign', ['--verify', '--deep', '--strict', '--all-architectures', app], { stdio: 'inherit' });
console.log(`Sealed ${targets.length} development code objects; existing runtime flags and entitlements are unchanged.`);
