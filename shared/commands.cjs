const launches = new Set(['com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'dev.zed.Zed', 'com.apple.dt.Xcode', 'com.apple.Terminal', 'com.apple.finder', 'com.apple.Safari', 'com.google.Chrome']);
const finite = (x, limit) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= limit;
function validateCommand(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid command.');
  const action = data.action;
  const id = typeof data.requestId === 'string' && data.requestId.length <= 80 ? data.requestId : undefined;
  let output;
  if (['move', 'drag', 'scroll'].includes(action) && finite(data.dx, 4000) && finite(data.dy, 4000)) output = { action, dx: data.dx, dy: data.dy };
  else if (action === 'moveTo' && finite(data.normX, 1) && finite(data.normY, 1) && data.normX >= 0 && data.normY >= 0) output = { action, normX: data.normX, normY: data.normY };
  else if (['click', 'down', 'up'].includes(action) && ['left', 'right', ...(action === 'click' ? ['double'] : [])].includes(data.button)) output = { action, button: data.button };
  else if (action === 'key' && Number.isInteger(data.code) && data.code >= 0 && data.code <= 126 && Array.isArray(data.modifiers) && data.modifiers.length <= 4 && data.modifiers.every(mod => ['cmd', 'ctrl', 'alt', 'shift'].includes(mod))) output = { action, code: data.code, modifiers: data.modifiers };
  else if (action === 'type' && typeof data.text === 'string' && data.text.length > 0 && data.text.length <= 4096) output = { action, text: data.text };
  else if (['listApps', 'getBounds', 'getPos', 'releaseAll', 'status'].includes(action)) output = { action };
  else if (action === 'activateApp' && Number.isInteger(data.pid) && data.pid > 0 && data.pid <= 2147483647) output = { action, pid: data.pid };
  else if (action === 'launchApp' && launches.has(data.bundleId)) output = { action, bundleId: data.bundleId };
  else if (action === 'appIcon' && typeof data.bundleId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.\-_]{0,199}$/.test(data.bundleId)) output = { action, bundleId: data.bundleId };
  else throw Error('Unsupported or invalid command.');
  return id ? { ...output, requestId: id } : output;
}
module.exports = { validateCommand };
