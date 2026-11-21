// Stage 4 지형: 평평한 시가지. 큰길 양쪽 인도만 15cm 높다(연석).
import { BOUNDS, STREET_H, CURB, ROAD, SQUARE } from './layout.js';
export function parisHeight(x, z) {
  const ax = Math.abs(x);
  if (z > SQUARE.z1 && ax > ROAD.half && ax < ROAD.walk + .01) return STREET_H + CURB;
  return STREET_H;
}
export const TERRAIN4 = { height: parisHeight, bounds: BOUNDS, floor: -2 };
