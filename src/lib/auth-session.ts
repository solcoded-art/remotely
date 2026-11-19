import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { request, serviceURL } from './api';
import { PRODUCTION_SERVICE, canonicalService, sameService, storageService } from '../../shared/account-service.mjs';
import type { Auth } from './types';

const isNative = () => !!window.macRemote || Capacitor.isNativePlatform();

export function accountServer() {
  const service = serviceURL(localStorage.getItem('macremote.server') || import.meta.env.VITE_ACCOUNT_SERVER || (isNative() ? PRODUCTION_SERVICE : window.location.origin));
  // Native apps move from the old Ongale address to enftify.com. The web keeps
  // the page's own origin, because its sign-in cookie belongs to that origin.
  return isNative() ? canonicalService(service) : service;
}
/** Native storage key for a service; production keeps the pre-enftify.com key. */
export function nativeStorageService(service: string) { return storageService(service); }
const key = (service: string) => 'remotely.session.' + encodeURIComponent(nativeStorageService(service));
export async function saveSession(auth: Auth) {
  if (window.macRemote?.authSession) await window.macRemote.authSession(nativeStorageService(auth.service), { token: auth.token, expires: auth.expires });
  else if (Capacitor.isNativePlatform()) await SecureStorage.set(key(auth.service), { token: auth.token, expires: auth.expires }, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  localStorage.setItem('macremote.server', auth.service); // Origin only; never a credential.
}
export async function clearSession(service: string) {
  if (window.macRemote?.authSession) await window.macRemote.authSession(nativeStorageService(service), null);
  else if (Capacitor.isNativePlatform()) await SecureStorage.remove(key(service), false);
}
export async function restoreSession(): Promise<Auth | null> {
  const service = accountServer();
  let token: string | undefined;
  if (window.macRemote?.authSession) token = (await window.macRemote.authSession(nativeStorageService(service)))?.token;
  else if (Capacitor.isNativePlatform()) {
    const saved = await SecureStorage.get(key(service), false, false);
    if (saved && typeof saved === 'object' && 'token' in saved && typeof saved.token === 'string') token = saved.token;
  }
  if ((window.macRemote || Capacitor.isNativePlatform()) && !token) return null;
  try {
    return { ...await request<Omit<Auth, 'service'>>(service, '/api/auth/session', { token }), service };
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 401) { await clearSession(service); return null; }
    throw error;
  }
}
export function takeSignInToken(): string {
  const match = /^#sign-in=([a-zA-Z0-9_-]{16,256})$/.exec(window.location.hash);
  if (!match) return '';
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}
export function signInLinkToken(raw: string, service: string) {
  const url = new URL(raw);
  // Links from either production address are valid for the same service.
  if (!sameService(url.origin, serviceURL(service)) || url.pathname !== '/' || url.search || url.username || url.password) throw Error('Use a sign-in link from this account server.');
  const token = /^#sign-in=([a-zA-Z0-9_-]{16,256})$/.exec(url.hash)?.[1];
  if (!token) throw Error('This sign-in link is invalid. Request a new one.');
  return token;
}
