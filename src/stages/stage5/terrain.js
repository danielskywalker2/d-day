// Stage 5 지형: 남쪽 숲(높음) → 골짜기의 풀밭(낮음) → 북쪽 언덕(높음, 꼭대기 요새) → 그 너머 독일 본토로 내려감.
// 참호·포탄 구덩이·지하 벙커 경사로를 판다. 지하 벙커 자리는 '게임 높이'만 바닥으로 낮추고, 화면의 지형(displayHeight)은 그대로 덮는다.
import { BOUNDS, OP, TRENCH, HQ, FINAL, BUNKERS, MORTAR } from './layout.js';

const sm = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
function profile(z) {
  if (z > 60) return 6 + (z - 60) * .06;
  if (z > 20) return 1.6 + 4.4 * sm(20, 60, z);
  if (z > -15) return 1.6 + 1.6 * sm(20, -15, z);
  if (z > -100) return 3.2 + 14.8 * sm(-15, -100, z);
  return 18 - 13 * sm(-104, -140, z);   // 언덕 너머(독일 쪽)는 골짜기로 내려감
}
export function surface(x, z) {
  let h = profile(z) + 1.6 * Math.sin(x * .045 + 1) * Math.cos(z * .035) + .7 * Math.sin(x * .11 + z * .07);
  h += 5 * Math.exp(-((x - OP.x) ** 2 + (z - OP.z) ** 2) / 220);
  // 벙커·박격포·요새 자리는 평평하게
  for (const B of BUNKERS) { const k = Math.exp(-((x - B.x) ** 2 + (z - B.z) ** 2) / 60); h = h * (1 - k) + surfaceRaw(B.x, B.z) * k; }
  { const k = Math.exp(-((x - FINAL.x) ** 2 + (z - FINAL.z) ** 2) / 260); h = h * (1 - k) + surfaceRaw(FINAL.x, FINAL.z) * k; }
  { const k = Math.exp(-((x - MORTAR.x) ** 2 + (z - MORTAR.z) ** 2) / 30); h = h * (1 - k) + (surfaceRaw(MORTAR.x, MORTAR.z) - .6) * k; }
  return h;
}
function surfaceRaw(x, z) { return profile(z) + 1.6 * Math.sin(x * .045 + 1) * Math.cos(z * .035) + .7 * Math.sin(x * .11 + z * .07); }

const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
export function trenchDist(x, z) { let d = 1e9; for (let i = 0; i < TRENCH.length - 1; i++) d = Math.min(d, segD(x, z, TRENCH[i], TRENCH[i + 1])); return d; }
export const TRENCH_DEPTH = 1.25;
export const CRATERS = [[-8, 50, 2.6], [14, 46, 3], [-28, 40, 2.4], [30, 52, 2.8], [-46, 22, 2.6], [4, 20, 3.2], [-14, 8, 2.4], [40, 12, 2.6], [-50, 50, 2.2], [52, 44, 2.4], [-4, 36, 2.2]];
/** 지하 벙커 바닥 높이: 덮인 땅에서 최소 3.3m 아래 */
export const HQ_FLOOR = (() => { let m = 1e9; for (let x = HQ.x0 - 1; x <= HQ.x1 + 1; x += 1) for (let z = HQ.z0 - 1; z <= HQ.z1 + 1; z += 1) m = Math.min(m, surface(x, z)); return m - 3.3; })();
export const HQ_SURF_MAX = (() => { let m = -1e9; for (let x = HQ.x0 - 1; x <= HQ.x1 + 1; x += 1) for (let z = HQ.z0 - 1; z <= HQ.z1 + 1; z += 1) m = Math.max(m, surface(x, z)); return m; })();

/** 화면에 그리는 지형(지하 벙커를 덮음) */
export function displayHeight(x, z) {
  let h = surface(x, z);
  const td = trenchDist(x, z); if (td < 1.9) h -= td < 1 ? TRENCH_DEPTH : TRENCH_DEPTH * (1.9 - td) / .9;
  for (const [cx, cz, r] of CRATERS) { const d = Math.hypot(x - cx, z - cz); if (d < r * 1.25) h += d < r ? -1.1 * (1 - (d / r) ** 2) : .25 * Math.sin((d - r) / (r * .25) * Math.PI); }
  const R = HQ.ramp;   // 경사로(지하 벙커 입구)
  if (x > R.x0 - .6 && x < R.x1 + .6 && z < R.z1 && z >= R.z0) { const t = (R.z1 - z) / (R.z1 - R.z0), top = surface(x, R.z1); h = Math.min(h, top + (HQ_FLOOR - top) * t); }
  return h;
}
/** 게임 높이(이동·사격 판정): 지하 벙커 안은 바닥 */
export function borderHeight(x, z) {
  if (x > HQ.x0 && x < HQ.x1 && z > HQ.z0 && z < HQ.z1) return HQ_FLOOR;
  return displayHeight(x, z);
}
/** 높이 y 의 물체 아래 땅: 지하 벙커 자리에서 천장보다 위에 있으면 덮인 땅, 아래면 벙커 바닥 */
export function borderGroundBelow(x, z, y) {
  if (x > HQ.x0 && x < HQ.x1 && z > HQ.z0 && z < HQ.z1 && y > HQ_FLOOR + 3) return displayHeight(x, z);
  return borderHeight(x, z);
}
export const TERRAIN5 = { height: borderHeight, groundBelow: borderGroundBelow, bounds: BOUNDS, floor: -4 };
