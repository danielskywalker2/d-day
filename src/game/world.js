// 전장 데이터 — 지형 높이, 충돌 박스, 사격 판정용 메시 목록, 시야 판정.
// 그래픽과 무관한 게임 규칙 계층. EnvironmentManager 가 소품을 만들면서 solids/colliders 를 채운다.
import * as THREE from 'three';
import { V3, sr, clamp } from '../core/utils.js';
const V = V3;

export const craters = [];
for (let i = 0; i < 16; i++) craters.push({ x: sr(-62, 62), z: sr(6, 66), r: sr(2.6, 4.6), d: sr(0.6, 1.25) });

export function baseH(z) {
  if (z > 74) return -(z - 74) * 0.07;
  if (z > -5) return 2.5 * (74 - z) / 79;
  if (z > -34) { const t = (-5 - z) / 29; return 2.5 + 10.5 * t * t * (3 - 2 * t); }
  return 13;
}
/** Stage 1(오마하 해변) 지형 높이 */
export function beachHeight(x, z) {
  let h = baseH(z);
  if (z > -30 && z < 74) {
    const k = Math.min(1, (z + 30) / 10) * Math.min(1, (74 - z) / 6);
    h += (Math.sin(x * 0.31 + z * 0.17) * 0.16 + Math.sin(x * 0.11 - z * 0.23 + 1.3) * 0.22) * k;
  }
  for (const c of craters) {
    const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, R = c.r * 1.35;
    if (d2 < R * R) { const d = Math.sqrt(d2); h += d < c.r ? -c.d * (Math.cos(Math.PI * d / c.r) + 1) / 2 + 0.12 : 0.12 * (1 - (d - c.r) / (R - c.r)); }
  }
  return h;
}

// 스테이지마다 지형이 다르다: setTerrain 으로 높이 함수와 판정 범위를 바꿔 끼운다(기본 = 오마하 해변)
let terrain = { height: beachHeight, bounds: { minX: -75, maxX: 75, minZ: -85, maxZ: 105 }, floor: -3 };
export function setTerrain(t) { terrain = { ...terrain, ...t }; }
export function terrainBounds() { return terrain.bounds; }
export function heightAt(x, z) { return terrain.height(x, z); }
/** 높이 y 에 있는 물체 바로 아래의 땅(지하 공간이 있는 스테이지는 위층 땅과 지하 바닥을 구분). 기본은 heightAt */
export function groundBelow(x, z, y) { return terrain.groundBelow ? terrain.groundBelow(x, z, y) : terrain.height(x, z); }

/** 지면 법선 (높이 함수의 기울기로 계산) */
export function groundNormal(x, z, out = new V()) { const e = .25; return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize(); }

/** 총알이 맞는 정적 메시(엄폐물). */
export const solids = [];
/** 이동을 막는 AABB 목록 { minX, maxX, minY, maxY, minZ, maxZ }. */
export const colliders = [];

export function pushOut(p, r, feet, height) {
  for (const c of colliders) {
    if (feet + 0.35 > c.maxY || feet + height < c.minY) continue;
    const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
    let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
    else { // 중심이 박스 안: 가장 가까운 면으로 밀어낸다
      const l = p.x - c.minX, rr = c.maxX - p.x, n = p.z - c.minZ, f = c.maxZ - p.z, m = Math.min(l, rr, n, f);
      if (m === l) p.x = c.minX - r; else if (m === rr) p.x = c.maxX + r; else if (m === n) p.z = c.minZ - r; else p.z = c.maxZ + r;
    }
  }
}
export function insideCollider(p) { for (const c of colliders) if (!c.walkOnly && p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) return true; return false; }

/** 광선이 지형에 처음 닿는 거리(없으면 -1). */
export function terrainHit(o, d, maxT, step) {
  let prev = 0.3;
  for (let t = 0.3 + step; t <= maxT + step; t += step) {
    const tt = Math.min(t, maxT), x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt;
    const B = terrain.bounds;
    if (x > B.minX && x < B.maxX && z > B.minZ && z < B.maxZ && y < heightAt(x, z)) {
      let a = prev, b = tt;
      for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      return a;
    }
    if (y < terrain.floor) return -1;
    prev = tt; if (tt >= maxT) break;
  }
  return -1;
}
const _losRc = new THREE.Raycaster(), _losD = new V3();
/** from → to 사이에 지형·엄폐물이 없으면 true. */
export function losClear(from, to) {
  _losD.subVectors(to, from); const dist = _losD.length(); _losD.multiplyScalar(1 / dist);
  if (terrainHit(from, _losD, dist - 0.6, 1.2) >= 0) return false;
  _losRc.set(from, _losD); _losRc.far = dist - 0.4; _losRc.near = 0;
  return _losRc.intersectObjects(solids, false).length === 0;
}
