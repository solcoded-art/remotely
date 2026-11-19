export const PRODUCTION_SERVICE: string;
export const LEGACY_PRODUCTION_SERVICE: string;
export function sameService(a: string, b: string): boolean;
export function canonicalService(origin: string): string;
export function storageService(origin: string): string;
