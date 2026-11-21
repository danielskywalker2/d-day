// Stage 3 지형: 거의 평평한 농지·마을 + 융단 폭격 구덩이(깊고 테두리가 솟음) + 도로는 살짝 볼록
import { CRATERS3, BOUNDS } from './layout.js';

export const TOWN_H = 1.2;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function cobraHeight(x, z) {
  let h = TOWN_H + .35 * Math.sin(x * .03 + .4) * Math.sin(z * .025) * ss(10, 40, z) + .25 * Math.sin(x * .11 + z * .07) * ss(25, 45, z);
  for (const c of CRATERS3) {
    const d = Math.hypot(x - c.x, z - c.z), R = c.r * 1.45;
    if (d < R) h += d < c.r ? -c.d * (Math.cos(Math.PI * d / c.r) + 1) / 2 + .25 : .25 * (1 - (d - c.r) / (R - c.r));   // 흙이 튀어 올라 생긴 테두리
  }
  return h;
}
export const TERRAIN3 = { height: cobraHeight, bounds: BOUNDS, floor: -3 };
