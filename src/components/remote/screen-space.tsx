import { createContext, useContext } from 'react';

/**
 * Fullscreen on a portrait phone rotates the session 90° with CSS when the
 * browser cannot lock orientation. Pointer math must then be converted from
 * viewport coordinates into the rotated surface's own coordinates.
 */
export type ScreenSpace = { rotated: boolean };
export const ScreenSpaceContext = createContext<ScreenSpace>({ rotated: false });
export const useScreenSpace = () => useContext(ScreenSpaceContext);

/** Converts a viewport movement into surface movement. */
export function toLocalDelta(rotated: boolean, dx: number, dy: number): [number, number] {
  return rotated ? [dy, -dx] : [dx, dy];
}

/**
 * Point relative to `element`'s top-left corner in its own (unrotated) space.
 * Uses layout offsets, which ignore CSS transforms, when rotated.
 */
export function toLocalPoint(rotated: boolean, element: HTMLElement, clientX: number, clientY: number): [number, number] {
  if (!rotated) { const rect = element.getBoundingClientRect(); return [clientX - rect.left, clientY - rect.top]; }
  // The rotated root covers the viewport: local x runs down the screen, local y runs right-to-left.
  let x = clientY, y = window.innerWidth - clientX;
  for (let node: HTMLElement | null = element; node && !node.hasAttribute('data-rotated'); node = node.offsetParent as HTMLElement | null) {
    x -= node.offsetLeft; y -= node.offsetTop;
  }
  return [x, y];
}
