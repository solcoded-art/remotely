const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const source = require('../fonts.source.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function prepare() {
  const target = path.resolve(__dirname, '../src/assets/fonts/Satoshi-Variable.woff2');
  try { if (digest(await fs.readFile(target)) === source.sha256) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Fontshare returned HTTP ${response.status}.`);
  if (!response.body) throw Error('Fontshare returned an empty response.');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 1024 * 1024) { await response.body.cancel().catch(() => {}); throw Error('Font response exceeded the size limit.'); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'wOF2' || digest(bytes) !== source.sha256) {
    throw Error('Satoshi failed integrity verification. Review the pinned source before updating it.');
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try { await fs.writeFile(temp, bytes); await fs.rename(temp, target); }
  finally { await fs.rm(temp, { force: true }); }
  console.log('Prepared verified Satoshi font for local bundling.');
}
prepare().catch(error => { console.error(`Font preparation failed: ${error.message} See docs/hardening/fonts.md.`); process.exitCode = 1; });
