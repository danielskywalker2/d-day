// InstanceLOD — 같은 모델을 여러 번 놓을 때 쓰는 거리별 인스턴싱(7단계 성능 최적화).
//   · 모델의 부품(메시)마다 InstancedMesh 하나 → 놓은 개수와 상관없이 부품 수만큼만 그린다(Draw Call 절약)
//   · 카메라와의 거리로 세 단계: 가까움(원본 + 그림자) / 중간(낮은 디테일 또는 원본, 그림자 없음) / 멂(숨김 또는 낮은 디테일)
//   · 카메라가 일정 거리 이상 움직였을 때만 인스턴스를 다시 나눈다(매 프레임 비용 거의 0)
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3();

export class InstanceLOD {
  /**
   * @param {THREE.Object3D} parent
   * @param {{geometry: THREE.BufferGeometry, material: THREE.Material, local?: THREE.Matrix4, low?: THREE.BufferGeometry}[]} parts 모델 부품(모델 원점 기준 local 변환)
   * @param {THREE.Matrix4[]} items 놓을 위치마다 월드 변환
   * @param {{near?: number, far?: number, lowShadow?: boolean, receive?: boolean}} o near 안: 원본+그림자, near~far: 중간 단계, far 밖: low 가 있으면 low(계속 보임) 없으면 숨김
   */
  constructor(parent, parts, items, { near = 40, far = 90, lowShadow = false, receive = true, colors = null } = {}) {
    Object.assign(this, { parts, items, near, far, lowShadow, colors });
    this.centers = items.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    const n = items.length;
    // 모프 타깃이 있는 모델(예: 녹슨 바퀴)은 인스턴싱에서 모프를 쓰지 않으므로 떼어 낸 사본을 쓴다
    for (const p of parts) if (Object.keys(p.geometry.morphAttributes || {}).length) { p.geometry = p.geometry.clone(); p.geometry.morphAttributes = {}; }
    const mk = (geo, mat, shadow) => { const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.castShadow = shadow; im.receiveShadow = receive; im.userData.visualOnly = true; im.frustumCulled = true; parent.add(im); return im; };
    this.levels = parts.map((p) => ({
      near: mk(p.geometry, p.material, true),
      mid: mk(p.geometry, p.material, false),
      far: p.low ? mk(p.low, p.material, lowShadow) : null,
      local: p.local || new THREE.Matrix4(),
    }));
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.stats = { near: 0, mid: 0, far: 0, hidden: 0 };
  }
  /** 카메라가 3m 넘게 움직였을 때만 다시 나눈다 */
  update(cam, force = false) {
    if (!force && cam.distanceToSquared(this.last) < 9) return false;
    this.last.copy(cam);
    const s = this.stats; s.near = s.mid = s.far = s.hidden = 0;
    for (const L of this.levels) { L.near.count = 0; L.mid.count = 0; if (L.far) L.far.count = 0; }
    const hasLow = !!this.levels[0].far;
    for (let i = 0; i < this.items.length; i++) {
      const d = this.centers[i].distanceTo(cam);
      const lvl = d < this.near ? 'near' : d < this.far ? (hasLow ? 'far' : 'mid') : hasLow ? 'far' : null;
      if (!lvl) { s.hidden++; continue; }
      s[lvl]++;
      for (const L of this.levels) { const im = L[lvl]; _m.multiplyMatrices(this.items[i], L.local); if (this.colors) im.setColorAt(im.count, this.colors[i]); im.setMatrixAt(im.count++, _m); }
    }
    for (const L of this.levels) for (const im of [L.near, L.mid, L.far]) if (im) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.visible = im.count > 0; if (im.count) im.computeBoundingSphere(); }
    return true;
  }
  get drawCount() { let n = 0; for (const L of this.levels) for (const im of [L.near, L.mid, L.far]) if (im && im.visible) n++; return n; }
}

/** 모델(Object3D)을 부품 목록으로 — 각 메시의 모델 원점 기준 변환 포함 */
export function partsOf(root) {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), parts = [];
  root.traverse((o) => { if (o.isMesh && o.visible) parts.push({ geometry: o.geometry, material: o.material, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }); });
  return parts;
}

/**
 * 모래주머니처럼 부드러운 물건의 낮은 디테일 판: 원본의 경계 상자에 맞춘 납작한 베개 모양(약 60 삼각형).
 * UV 는 원본처럼 0~1 로 펼쳐 같은 재질을 그대로 쓴다.
 */
export function pillowLOD(geometry) {
  geometry.computeBoundingBox(); const b = geometry.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const g = new THREE.SphereGeometry(.5, 10, 5), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { _p.fromBufferAttribute(p, i); const y = Math.sign(_p.y) * Math.min(Math.abs(_p.y) * 1.5, .5); p.setXYZ(i, c.x + _p.x * s.x * 1.04, c.y + y * s.y, c.z + _p.z * s.z * 1.04); }
  g.computeVertexNormals(); return g;
}

const _mergeCache = new Map();
/**
 * 움직이지 않는 부품들로 된 모델을 재질별 메시 하나씩으로 합친 복제본(Draw Call 절약). 합친 지오메트리는 key 로 캐시해 공유한다.
 * build() 는 처음 한 번만 호출된다. 숨긴(visible=false) 메시는 빠진다.
 */
export function mergedClone(key, build, { castShadow = true } = {}) {
  let parts = _mergeCache.get(key);
  if (!parts) {
    const root = build(); root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), by = new Map();
    root.traverse((o) => { if (!o.isMesh) return; for (let p = o; p; p = p.parent) if (!p.visible) return;
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      geo.morphAttributes = {};
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      const mat = Array.isArray(o.material) ? o.material[0] : o.material; if (!by.has(mat)) by.set(mat, []); by.get(mat).push(geo); });
    parts = [...by].map(([mat, geos]) => ({ mat, geo: geos.length > 1 ? mergeGeometries(geos, false) : geos[0] })); _mergeCache.set(key, parts);
  }
  const g = new THREE.Group(); for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = castShadow; m.receiveShadow = true; g.add(m); } return g;
}
