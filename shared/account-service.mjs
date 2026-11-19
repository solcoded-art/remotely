// The hosted account service is reachable at two addresses. `enftify.com` is
// the production domain; earlier native releases defaulted to the Ongale
// address, which still serves the same service. Both share one identity.

export const PRODUCTION_SERVICE = 'https://enftify.com';
export const LEGACY_PRODUCTION_SERVICE = 'https://remotely-marisol-workspace-k1zb.ongale.dev';
const PRODUCTION_ALIASES = new Set([PRODUCTION_SERVICE, LEGACY_PRODUCTION_SERVICE]);

/** True when both origins reach the same account service. */
export function sameService(a, b) {
  return a === b || (PRODUCTION_ALIASES.has(a) && PRODUCTION_ALIASES.has(b));
}

/** Where native apps send requests: the legacy address is upgraded to production. */
export function canonicalService(origin) {
  return origin === LEGACY_PRODUCTION_SERVICE ? PRODUCTION_SERVICE : origin;
}

/**
 * Key that native apps store sign-ins and device keys under. Production keeps
 * the key earlier releases used, so moving domains neither signs people out
 * nor changes a device's key (which would require re-pairing).
 */
export function storageService(origin) {
  return PRODUCTION_ALIASES.has(origin) ? LEGACY_PRODUCTION_SERVICE : origin;
}
