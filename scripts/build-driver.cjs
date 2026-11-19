const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arch = process.env.MAC_REMOTE_ARCH || process.arch;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw Error('The input helper must be built on macOS for arm64 or x64.');
fs.mkdirSync('bin', { recursive: true });
execFileSync('swiftc', ['-O', '-target', `${arch === 'x64' ? 'x86_64' : arch}-apple-macos13.0`, '-module-cache-path', path.join(os.tmpdir(), 'mac-remote-swift-cache'), 'driver/mac_driver.swift', '-o', 'bin/mac_driver'], { stdio: 'inherit' });
