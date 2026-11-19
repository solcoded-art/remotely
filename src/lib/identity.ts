import { b64, encode, keyId, publicKey, type PublicKey } from '../../shared/trust.mjs';
import type { Auth } from './types';
import { Capacitor } from '@capacitor/core';
import { storageService } from '../../shared/account-service.mjs';

export type Pin = { grantId: string; key: PublicKey; name: string };
export type Identity = { id: string; publicKey: PublicKey; sign(message: string): Promise<string>; pins(): Promise<Record<string, Pin>>; pin(id: string, value: Pin | null): Promise<void> };
const pending = new Map<string, Promise<Identity>>();
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('remotely-trusted-devices', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('identities');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error('Device key storage is unavailable. Allow site storage and try again.'));
  });
}
export function deviceIdentity(auth: Auth): Promise<Identity> {
  // Native apps key device identities by a stable storage service, so the move
  // to enftify.com keeps existing device keys and pairings.
  const native = !!window.macRemote || Capacitor.isNativePlatform();
  const scope = JSON.stringify([native ? storageService(auth.service) : auth.service, auth.user.id]);
  if (!pending.has(scope)) pending.set(scope, load(scope).catch(error => { pending.delete(scope); throw error; }));
  return pending.get(scope)!;
}
async function load(scope: string): Promise<Identity> {
  if (window.macRemote) {
    const bridge = window.macRemote;
    const key = publicKey(await bridge.identity(scope));
    return { id: await keyId(key), publicKey: key, sign: message => bridge.sign(scope, message), pins: () => bridge.pins(scope), pin: (id, value) => bridge.pin(scope, id, value) };
  }
  const db = await database();
  async function read() {
    return new Promise<{ keys: CryptoKeyPair; pins: Record<string, Pin> } | undefined>((resolve, reject) => {
      const tx = db.transaction('identities', 'readonly'); const req = tx.objectStore('identities').get(scope);
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(Error('Cannot read the device key.'));
    });
  }
  // Generate before a short transaction; concurrent tabs use add() so the first stored identity wins.
  if (!await read()) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('identities', 'readwrite'); const req = tx.objectStore('identities').add({ keys, pins: {} }, scope);
      req.onerror = event => { if (req.error?.name === 'ConstraintError') { event.preventDefault(); event.stopPropagation(); } };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(Error('Cannot save the device key.'));
    });
  }
  const record = (await read())!;
  if (!record?.keys?.privateKey || record.keys.privateKey.extractable) throw Error('Invalid device key storage. Pair this installation again after restoring site storage.');
  const key = publicKey(await crypto.subtle.exportKey('jwk', record.keys.publicKey));
  return {
    id: await keyId(key), publicKey: key,
    sign: async message => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.keys.privateKey, encode(message))),
    pins: async () => (await read())!.pins,
    pin: async (id, value) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('identities', 'readwrite'); const store = tx.objectStore('identities'); const req = store.get(scope);
      req.onsuccess = () => { const current = req.result; if (value) current.pins[id] = value; else delete current.pins[id]; store.put(current, scope); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(Error('Cannot save trusted device.'));
    }),
  };
}
