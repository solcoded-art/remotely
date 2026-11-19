// Versioned, fixed-shape transcripts. Private keys and pairing secrets never cross the signaling service.
export const PROTOCOL = 'remotely-trust-v1';
export const encode = value => new TextEncoder().encode(value);
export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function unb64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw Error('Invalid encoding.');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (b64(bytes) !== value) throw Error('Invalid encoding.');
  return bytes;
}
export const nonce = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export function publicKey(value) {
  if (!value || value.kty !== 'EC' || value.crv !== 'P-256' || 'd' in value || Object.keys(value).some(k => !['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(k))) throw Error('A public P-256 device key is required.');
  if (unb64(value.x).length !== 32 || unb64(value.y).length !== 32) throw Error('Invalid device key.');
  return { crv: 'P-256', kty: 'EC', x: value.x, y: value.y };
}
export async function keyId(key) { return 'd_' + b64(await crypto.subtle.digest('SHA-256', encode(JSON.stringify(publicKey(key))))); }
export const transcript = (purpose, ...values) => JSON.stringify([PROTOCOL, purpose, ...values]);
export const registration = (challenge, userId, device) => transcript('register', challenge, userId, device.id, device.name, device.kind, publicKey(device.publicKey));
export const hello = (challenge, userId, deviceId) => transcript('hello', challenge, userId, deviceId);
export const envelope = (challenge, userId, deviceId, seq, data) => transcript('message', challenge, userId, deviceId, seq, data);
export const pairing = (inviteId, requestId, userId, desktopId, controllerId, key) => transcript('pair', inviteId, requestId, userId, desktopId, controllerId, publicKey(key));
export const grantText = grant => transcript('grant', grant.id, grant.userId, grant.desktopId, grant.controllerId, publicKey(grant.desktopKey), publicKey(grant.controllerKey), grant.inviteId, grant.requestId);
export const sessionRequest = (userId, grantId, desktopId, controllerId, nonce) => transcript('session-request', userId, grantId, desktopId, controllerId, nonce);
export const sessionApproval = (sessionId, userId, grantId, desktopId, controllerId, controllerNonce, desktopNonce) => transcript('session-approval', sessionId, userId, grantId, desktopId, controllerId, controllerNonce, desktopNonce);
export const signalText = (sessionId, grantId, senderId, seq, signal, binding) => transcript('signal', sessionId, grantId, senderId, binding, seq, signal);
export async function verify(key, value, signature) {
  try {
    const bytes = unb64(signature); if (bytes.length !== 64) return false;
    const imported = await crypto.subtle.importKey('jwk', publicKey(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, bytes, encode(value));
  } catch { return false; }
}
export async function proof(secret, value) {
  const bytes = unb64(secret); if (bytes.length !== 32) throw Error('Invalid pairing secret.');
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, encode(value)));
}
export async function verifyProof(secret, value, signature) {
  try {
    const bytes = unb64(secret); if (bytes.length !== 32) return false;
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, unb64(signature), encode(value));
  } catch { return false; }
}
