import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { request, serviceURL } from './api';
import type { Auth } from './types';

export function accountServer() {
  return serviceURL(localStorage.getItem('macremote.server') || import.meta.env.VITE_ACCOUNT_SERVER || (window.macRemote || Capacitor.isNativePlatform() ? 'https://remotely-marisol-workspace-k1zb.ongale.dev' : window.location.origin));
}
const key = (service: string) => 'remotely.session.' + encodeURIComponent(service);
export async function saveSession(auth: Auth) {
  if (window.macRemote?.authSession) await window.macRemote.authSession(auth.service, { token: auth.token, expires: auth.expires });
  else if (Capacitor.isNativePlatform()) await SecureStorage.set(key(auth.service), { token: auth.token, expires: auth.expires }, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  localStorage.setItem('macremote.server', auth.service); // Origin only; never a credential.
}
export async function clearSession(service: string) {
  if (window.macRemote?.authSession) await window.macRemote.authSession(service, null);
  else if (Capacitor.isNativePlatform()) await SecureStorage.remove(key(service), false);
}
export async function restoreSession(): Promise<Auth | null> {
  const service = accountServer();
  let token: string | undefined;
  if (window.macRemote?.authSession) token = (await window.macRemote.authSession(service))?.token;
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
  if (url.origin !== serviceURL(service) || url.pathname !== '/' || url.search || url.username || url.password) throw Error('Use a sign-in link from this account server.');
  const token = /^#sign-in=([a-zA-Z0-9_-]{16,256})$/.exec(url.hash)?.[1];
  if (!token) throw Error('This sign-in link is invalid. Request a new one.');
  return token;
}
