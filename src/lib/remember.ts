import { useSyncExternalStore } from 'react';
import * as trust from '../../shared/trust.mjs';

/**
 * Remembered approvals: the Mac may let one paired phone reconnect without a new prompt
 * for a limited time, but only after the phone proves a fresh device unlock (Face ID,
 * Touch ID or passcode) with a passkey the Mac has recorded. The Mac verifies the proof
 * and still signs every session approval itself; the account service never decides.
 */
export const REMEMBER_MAX_MS = 3 * 24 * 60 * 60_000;
export const REMEMBER_OPTIONS = [
  { label: 'Ask every time', ms: 0 },
  { label: '12 hours', ms: 12 * 60 * 60_000 },
  { label: '1 day', ms: 24 * 60 * 60_000 },
  { label: '3 days', ms: REMEMBER_MAX_MS },
] as const;

/** Proof of a fresh unlock, sent with a connection request. All fields are base64url. */
export type Unlock = { credentialId: string; authenticatorData: string; clientDataJSON: string; signature: string };
/** The phone's passkey, as sent to the Mac when remembering is turned on. */
export type UnlockKey = { kind: 'create' | 'get'; credentialId: string; publicKey: string; authenticatorData: string; clientDataJSON: string; signature?: string };

const B64 = /^[A-Za-z0-9_-]+$/;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const sha256 = async (bytes: Uint8Array | string) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? trust.encode(bytes) : bytes as BufferSource));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);

/** What the phone signs with its passkey to reconnect: bound to this account, both devices and this request's nonce. */
export const unlockText = (userId: string, desktopId: string, controllerId: string, controllerNonce: string) => trust.transcript('session-unlock', userId, desktopId, controllerId, controllerNonce);

export function isUnlock(value: unknown): value is Unlock {
  const item = value as Unlock;
  return !!item && typeof item === 'object' && [item.credentialId, item.authenticatorData, item.clientDataJSON, item.signature].every(field => typeof field === 'string' && field.length <= 2048 && B64.test(field));
}

// ---------- Phone ----------

const KEY_STORE = 'remotely.unlock-key';
const MACS_STORE = 'remotely.remembered-macs';
type PhoneKey = { credentialId: string; publicKey: string };
type RememberedMac = { grantId: string; until: number };
function readJSON<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function writeJSON(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

let support: Promise<boolean> | null = null;
/** Only real web origins can hold a passkey; the bundled iOS wrapper cannot. */
export function canUseUnlock() {
  support ??= (async () => {
    try {
      // Passkeys need a domain name: not the bundled wrapper (capacitor://), not a bare IP address.
      if (!window.isSecureContext || !/^https?:$/.test(location.protocol) || /^[\d.]+$|:/.test(location.hostname) || typeof PublicKeyCredential === 'undefined') return false;
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  })();
  return support;
}

export const phoneRemember = {
  /** The remembered window for this Mac, if it is still open. */
  get(desktopId: string, grantId: string) {
    const record = readJSON<Record<string, RememberedMac>>(MACS_STORE, {})[desktopId];
    return record && record.grantId === grantId && record.until > Date.now() && record.until <= Date.now() + REMEMBER_MAX_MS ? record : null;
  },
  set(desktopId: string, record: RememberedMac | null) {
    const all = readJSON<Record<string, RememberedMac>>(MACS_STORE, {});
    if (record) all[desktopId] = record; else delete all[desktopId];
    writeJSON(MACS_STORE, all);
  },
  key: () => { const key = readJSON<PhoneKey | null>(KEY_STORE, null); return key && B64.test(key.credentialId) && B64.test(key.publicKey) ? key : null; },
};

/**
 * Proves a fresh unlock for a challenge. Call it first in a tap handler: browsers require
 * the user's tap to still be active when the passkey prompt opens.
 */
export async function assertUnlock(challenge: Uint8Array, credentialId: string) {
  const credential = await navigator.credentials.get({ publicKey: { challenge: challenge as BufferSource, rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: trust.unb64(credentialId) as BufferSource }], userVerification: 'required', timeout: 60000 } }) as PublicKeyCredential | null;
  const response = credential?.response as AuthenticatorAssertionResponse | undefined;
  if (!credential || !response) throw Error('Unlock was cancelled.');
  return { credentialId: trust.b64(credential.rawId), authenticatorData: trust.b64(response.authenticatorData), clientDataJSON: trust.b64(response.clientDataJSON), signature: trust.b64(response.signature) } satisfies Unlock;
}

/** Answers the Mac's offer: reuses this phone's passkey, or creates one. */
export async function unlockKeyFor(challenge: string): Promise<UnlockKey> {
  const existing = phoneRemember.key();
  if (existing) {
    try { return { kind: 'get', publicKey: existing.publicKey, ...await assertUnlock(trust.unb64(challenge), existing.credentialId) }; }
    catch (error) {
      // Browsers report a cancelled prompt and a deleted passkey the same way. Forget the key,
      // so trying again creates a new one instead of failing forever.
      try { localStorage.removeItem(KEY_STORE); } catch { /* storage unavailable */ }
      throw error;
    }
  }
  const credential = await navigator.credentials.create({ publicKey: {
    rp: { id: location.hostname, name: 'Remotely' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Remotely', displayName: 'Remotely reconnect' },
    challenge: trust.unb64(challenge) as BufferSource,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    attestation: 'none', timeout: 60000,
  } }) as PublicKeyCredential | null;
  const response = credential?.response as AuthenticatorAttestationResponse | undefined;
  const publicKey = response?.getPublicKey?.();
  if (!credential || !response || !publicKey || response.getPublicKeyAlgorithm() !== -7) throw Error('This phone cannot create an unlock passkey.');
  const key = { credentialId: trust.b64(credential.rawId), publicKey: trust.b64(publicKey) };
  writeJSON(KEY_STORE, key);
  return { kind: 'create', ...key, authenticatorData: trust.b64(response.getAuthenticatorData()), clientDataJSON: trust.b64(response.clientDataJSON) };
}

// ---------- Mac ----------

/** A phone this Mac lets reconnect without a prompt, until `until`. `origin` is the web address its passkey belongs to. */
export type RememberedPhone = { grantId: string; credentialId: string; publicKey: string; origin: string; until: number };
const macListeners = new Set<() => void>();
let macScope = '';
let macRecords: Record<string, RememberedPhone> = {};
const macKey = () => 'remotely.remembered-phones:' + macScope;
function saveMac(next: Record<string, RememberedPhone>) {
  macRecords = next; writeJSON(macKey(), next); macListeners.forEach(listener => listener());
}

export const macRemember = {
  /** Records are per account server and account. */
  open(service: string, userId: string) {
    macScope = JSON.stringify([service, userId]);
    const saved = readJSON<Record<string, RememberedPhone>>(macKey(), {});
    macRecords = Object.fromEntries(Object.entries(saved).filter(([, record]) => record && record.until > Date.now() && record.until <= Date.now() + REMEMBER_MAX_MS));
    macListeners.forEach(listener => listener());
  },
  get: () => macRecords,
  active(controllerId: string, grantId: string) {
    const record = macRecords[controllerId];
    return record && record.grantId === grantId && record.until > Date.now() ? record : null;
  },
  set(controllerId: string, record: RememberedPhone) { saveMac({ ...macRecords, [controllerId]: { ...record, until: Math.min(record.until, Date.now() + REMEMBER_MAX_MS) } }); },
  forget(controllerId: string) { const next = { ...macRecords }; delete next[controllerId]; saveMac(next); },
  forgetGrant(grantId: string) { saveMac(Object.fromEntries(Object.entries(macRecords).filter(([, record]) => record.grantId !== grantId))); },
  forgetAll() { saveMac({}); },
  subscribe(listener: () => void) { macListeners.add(listener); return () => { macListeners.delete(listener); }; },
};
export function useRememberedPhones() { return useSyncExternalStore(macRemember.subscribe, macRemember.get); }

/** WebAuthn signatures are DER; WebCrypto expects raw r‖s. */
function derToRaw(der: Uint8Array) {
  if (der[0] !== 0x30 || der[2] !== 0x02) throw Error('Invalid signature.');
  const rLength = der[3]; const r = der.slice(4, 4 + rLength);
  if (der[4 + rLength] !== 0x02) throw Error('Invalid signature.');
  const s = der.slice(6 + rLength, 6 + rLength + der[5 + rLength]);
  const part = (value: Uint8Array) => { const trimmed = value.slice(Math.max(0, value.length - 32)); const out = new Uint8Array(32); out.set(trimmed, 32 - trimmed.length); return out; };
  const raw = new Uint8Array(64); raw.set(part(r)); raw.set(part(s), 32); return raw;
}

/** Checks the parts every WebAuthn response shares: type, challenge, origin, relying party and a verified user. */
async function checkCeremony(type: 'webauthn.get' | 'webauthn.create', authenticatorData: Uint8Array, clientDataJSON: Uint8Array, challenge: string, origin: string) {
  const client = JSON.parse(decode(clientDataJSON));
  if (client.type !== type || client.challenge !== challenge || client.origin !== origin) return false;
  // Flags: user present (0x01) and user verified (0x04).
  return authenticatorData.length >= 37 && equal(authenticatorData.slice(0, 32), await sha256(new URL(origin).hostname)) && (authenticatorData[32] & 0x05) === 0x05;
}

/** Verifies a passkey assertion against a recorded public key (SPKI, base64url). */
export async function verifyUnlock(publicKey: string, unlock: Unlock, challenge: string, origin: string) {
  try {
    const authenticatorData = trust.unb64(unlock.authenticatorData); const clientDataJSON = trust.unb64(unlock.clientDataJSON);
    if (!await checkCeremony('webauthn.get', authenticatorData, clientDataJSON, challenge, origin)) return false;
    const key = await crypto.subtle.importKey('spki', trust.unb64(publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = new Uint8Array(authenticatorData.length + 32); signed.set(authenticatorData); signed.set(await sha256(clientDataJSON), authenticatorData.length);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(trust.unb64(unlock.signature)) as BufferSource, signed as BufferSource);
  } catch { return false; }
}

/** A passkey origin the Mac accepts: HTTPS, or localhost during development. */
function passkeyOrigin(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.origin === value && (url.protocol === 'https:' || url.hostname === 'localhost') ? url.origin : null;
  } catch { return null; }
}

/**
 * Verifies the passkey a phone offers when remembering is turned on. Returns the web origin
 * the passkey belongs to, which every later unlock must match, or null.
 */
export async function verifyUnlockKey(key: UnlockKey, challenge: string): Promise<string | null> {
  try {
    const origin = passkeyOrigin(JSON.parse(decode(trust.unb64(key.clientDataJSON))).origin);
    if (!origin) return null;
    if (!B64.test(key.credentialId) || key.credentialId.length > 2048 || !B64.test(key.publicKey) || key.publicKey.length > 512) return null;
    await crypto.subtle.importKey('spki', trust.unb64(key.publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = key.kind === 'get'
      ? !!key.signature && await verifyUnlock(key.publicKey, { credentialId: key.credentialId, authenticatorData: key.authenticatorData, clientDataJSON: key.clientDataJSON, signature: key.signature }, challenge, origin)
      // A new passkey: the session's data channel already authenticates the phone; check the ceremony itself.
      : key.kind === 'create' && await checkCeremony('webauthn.create', trust.unb64(key.authenticatorData), trust.unb64(key.clientDataJSON), challenge, origin);
    return valid ? origin : null;
  } catch { return null; }
}
