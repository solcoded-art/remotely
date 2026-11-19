import { Capacitor } from '@capacitor/core';

/** True in a browser; false inside the iOS (Capacitor) or Mac (Electron) app. */
export function isWebClient() {
  return !window.macRemote && !Capacitor.isNativePlatform();
}

export type PublicRoute = 'home' | 'sign-in' | 'sign-up';

/**
 * Signed-out routes for the web. Native apps always open on sign-in, since the
 * marketing landing page is only for browsers. The server serves index.html
 * for these paths (see signaling/service.cjs).
 */
export const AUTH_PATHS: Record<string, Exclude<PublicRoute, 'home'>> = {
  '/login': 'sign-in',
  '/signin': 'sign-in',
  '/signup': 'sign-up',
  '/get-started': 'sign-up',
};

export function publicRoute(): PublicRoute {
  if (!isWebClient()) return 'sign-in';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return AUTH_PATHS[path] ?? 'home';
}
