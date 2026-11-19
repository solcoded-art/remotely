// Update prompts for the Mac companion. The renderer may only ask the main
// process to open the account service's fixed download page; it can never pass
// an arbitrary URL to shell.openExternal.

const VERSION = /^\d+\.\d+\.\d+$/;

/** `<origin>/download/mac` for an https origin, or a loopback http origin in development. */
function downloadPageURL(service) {
  let url;
  try { url = new URL(String(service)); } catch { throw Error('Invalid account service address.'); }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw Error('Updates are only downloaded over HTTPS.');
  if (url.username || url.password) throw Error('Invalid account service address.');
  return `${url.origin}/download/mac`;
}

function parseVersion(value) {
  if (typeof value !== 'string' || !VERSION.test(value)) return null;
  return value.split('.').map(Number);
}

/** True when `candidate` is a strictly newer x.y.z version than `current`. */
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate); const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

module.exports = { downloadPageURL, isNewerVersion, parseVersion };
