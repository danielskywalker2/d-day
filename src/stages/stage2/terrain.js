// Stage 2 지형 높이: 완만하게 오르내리는 들판 + 움푹 꺼진 농로 + 방어선 뒤 참호 + 박격포 구덩이 + 평평한 농장 마당
import { TRENCH, FARM_FLAT, MORTAR, BOUNDS } from './layout.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rolling(x, z) { return 2.2 + 1.1 * Math.sin(x * .021 + .7) * Math.cos(z * .017) + .55 * Math.sin(z * .031 + x * .011) + .22 * Math.sin(x * .09 + z * .07); }
export const FARM_H = rolling(5, -71);

/** 포탄 구덩이 몇 개(전투가 지나간 들판) */
export const CRATERS2 = [{ x: -30, z: 40, r: 2.4 }, { x: 22, z: 12, r: 2.8 }, { x: -6, z: 2, r: 2.2 }, { x: 50, z: -24, r: 2.6 }, { x: -26, z: -32, r: 2.4 }, { x: 8, z: 46, r: 2 }];

export function hedgerowHeight(x, z) {
  let h = rolling(x, z);
  // 농장 마당: 가장자리 6m 에 걸쳐 평평한 높이로
  const inner = Math.min(x - FARM_FLAT.minX, FARM_FLAT.maxX - x, z - FARM_FLAT.minZ, FARM_FLAT.maxZ - z);
  h += (FARM_H - h) * ss(-6, 1, inner);
  // 움푹 꺼진 농로(출발 지점): 폭 약 6m, 깊이 1m
  if (z > 54) h -= 1.0 * (1 - ss(2.4, 4.3, Math.abs(x))) * ss(55, 63, z);
  // 방어선 뒤 참호: 깊이 0.85m, 양끝은 경사
  if (x > TRENCH.minX - 2 && x < TRENCH.maxX + 2) {
    const dz = Math.min(z - TRENCH.minZ, TRENCH.maxZ - z), dx = Math.min(x - TRENCH.minX, TRENCH.maxX - x);
    h -= .85 * ss(-.5, .45, dz) * ss(-2, 0, dx);
  }
  // 박격포 구덩이
  const md = Math.hypot(x - MORTAR.x, z - MORTAR.z); if (md < 4.2) h -= .8 * (1 - ss(2.3, 4.2, md));
  for (const c of CRATERS2) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r * 1.35) h += d < c.r ? -.55 * (Math.cos(Math.PI * d / c.r) + 1) / 2 + .08 : .08 * (1 - (d - c.r) / (c.r * .35)); }
  return h;
}

export const TERRAIN2 = { height: hedgerowHeight, bounds: BOUNDS, floor: -2 };
