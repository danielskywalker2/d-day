// Stage 5 전장 그래픽 — 1944년 가을 독일 국경: 가문비나무·단풍 든 너도밤나무 숲, 골짜기 풀밭, 지그재그 참호와 철조망,
// 용의 이빨(콘크리트 대전차 장애물), 지크프리트선 벙커, 박격포 진지, 나무 위 저격대, 지하 지휘 벙커(경사로·복도·방),
// 언덕 꼭대기 관측 요새, 그 너머 멀리 보이는 독일 본토의 구릉과 마을.
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/jsm/utils/BufferGeometryUtils.js';
import { EnvironmentManager } from '../../graphics/EnvironmentManager.js';
import { createTerrainMaterial } from '../../graphics/TerrainMaterial.js';
import * as PB from '../../graphics/PropBuilder.js';
import { heightAt, solids, colliders } from '../../game/world.js';
import { V3, clamp } from '../../core/utils.js';
import { PLAYER_BOX, OP, TRENCH, WIRE_Z, TEETH, roadX, BUNKERS, MORTAR, SNIPER_STANDS, HQ, FINAL } from './layout.js';
import { displayHeight, surface, trenchDist, CRATERS, HQ_FLOOR, HQ_SURF_MAX, TRENCH_DEPTH } from './terrain.js';

const LAYERS = [
  { name: 'leafy_grass', tile: 2.6, rough: .95 },       // 0 풀밭
  { name: 'forest_leaves_02', tile: 2.4, rough: .95 },  // 1 숲 바닥(낙엽)
  { name: 'brown_mud', tile: 2.2, rough: .9 },          // 2 길·참호 흙
  { name: 'rocky_gravel', tile: 2.4, rough: .9 },       // 3 언덕 자갈
  { name: 'burned_ground_01', tile: 3.0, rough: .95 },  // 4 포탄 구덩이
  { name: 'sparse_grass', tile: 2.8, rough: .95 },      // 5 언덕 위 마른 풀
];
let seed = 1091944; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const rr = (a, b) => a + rnd() * (b - a);
const F = HQ_FLOOR, CEIL = 2.8;

/** 숲이 얼마나 빽빽한가(0~1) */
export function forestAt(x, z) {
  const ax = Math.abs(x); let f = 0;
  if (ax > 58) f = 1;
  if (z > 74) f = Math.max(f, Math.abs(x - roadX(z)) > 6 && Math.hypot(x, z - 106) > 9 ? 1 : 0);
  if (Math.hypot(x - OP.x, z - OP.z) < 22 && z > 56) f = Math.max(f, Math.hypot(x - OP.x, z - OP.z) > 7 ? .8 : 0);
  if (z < -22 && z > -112) { const lane = Math.abs(x - roadX(z)) < 7, hq = x > -14 && x < 24 && z > -60, fin = Math.hypot(x - FINAL.x, z - FINAL.z) < 20; f = Math.max(f, lane || hq || fin ? 0 : (ax > 18 ? .75 : .35)); }
  if (z < -112 || (z < -94 && Math.abs(x - FINAL.x) < 34)) f = 0;   // 꼭대기에서 독일 쪽을 내려다보는 시야는 비움
  return f;
}

export class BorderEnvironment extends EnvironmentManager {
  constructor(deps) { super(deps); this.stageId = 5; this.smokeSources = [[-14, 46], [44, -2]]; this.fireSources = [[-14, 46]]; this.bunkerMeshes = []; }

  build() {
    this.lods = []; this.gfxSwap = []; this.geo = new Map();
    this.PM = this._materials(); this._borderMaterials();
    this._terrain5();
    this._skyAndWater(); this.water.visible = false;
    this._forest();
    this._trenches(); this._wires(); this._teeth(); this._bunkers(); this._mortar(); this._sniperStands();
    this._hq(); this._final(); this._vehicles(); this._germany();
    this._flush();
    this.scene.traverse((o) => { if (o.isMesh && !o.userData.keepShadow && o !== this.terrain && o !== this.water && o !== this.sky) { o.castShadow = o.visible && !o.userData.noShadow; o.receiveShadow = true; } });
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => { if (o !== this.scene && o !== this.sky && o !== this.water && !o.isLight && o !== this.lighting.sun.target && !o.userData.dynamic) o.matrixAutoUpdate = false; });
  }

  // ------------------------------------------------------------- 재질
  _borderMaterials() {
    const a = this.assets, S = (o) => new THREE.MeshStandardMaterial(o), conc = a.pbr('cracked_concrete_wall', .5, .5);
    this.P5 = {
      tooth: S({ color: 0xbdb8ac, ...a.pbr('cracked_concrete_wall', .7, .7) }),
      inner: S({ color: 0xb8b2a4, ...conc, emissive: 0x3a3226, emissiveMap: conc.map, emissiveIntensity: 1 }),   // 지하 벽: 전등 빛을 재질에 넣음(점광원 없이)
      floor: S({ color: 0x9a9284, ...a.pbr('wood_textured_concrete', .6, .6), emissive: 0x241e16 }),
      plank: S({ color: 0xa08868, ...a.pbr('weathered_planks', .6, .6), emissive: 0x1c140c }),
      bark: S({ color: 0x9a8a78, ...a.pbr('bark_brown_02', .5, 1.4) }),
      spruce: S({ map: this._needleTexture(), roughness: .95, color: 0xffffff }),
      beech: S({ map: this._autumnTexture(), roughness: .95, color: 0xffffff }),
      grey: S({ color: 0x5a5e54, roughness: .8, metalness: .2 }), olive: S({ color: 0x6b6a4c, roughness: .85 }),
      tyre: S({ color: 0x1a1a1a, roughness: .9 }),
      lamp: S({ color: 0xffe2a0, emissive: 0xffc870, emissiveIntensity: 2.5 }),
      map: S({ map: this._mapTexture(), roughness: .9, emissive: 0x2a2418, emissiveMap: null }),
      sign: S({ map: this._signTexture(), roughness: .9 }),
      far: new THREE.MeshLambertMaterial({ color: 0x2c3628 }), farHouse: new THREE.MeshLambertMaterial({ color: 0x8a7e70 }), farRoof: new THREE.MeshLambertMaterial({ color: 0x5a3a30 }),
    };
  }
  _canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
  _needleTexture() { return this._canvas(256, 256, (g, W) => { g.fillStyle = '#18261a'; g.fillRect(0, 0, W, W); for (let i = 0; i < 2600; i++) { const x = rnd() * W, y = rnd() * W; g.strokeStyle = `hsl(${120 + rnd() * 30},${25 + rnd() * 20}%,${10 + rnd() * 18}%)`; g.lineWidth = 1 + rnd(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-5, 5), y + rr(3, 8)); g.stroke(); } }); }
  _autumnTexture() { return this._canvas(256, 256, (g, W) => { g.fillStyle = '#5a3416'; g.fillRect(0, 0, W, W); for (let i = 0; i < 1500; i++) { g.save(); g.translate(rnd() * W, rnd() * W); g.rotate(rnd() * 6.28); g.fillStyle = `hsl(${18 + rnd() * 30},${55 + rnd() * 30}%,${22 + rnd() * 26}%)`; g.beginPath(); g.ellipse(0, 0, 5 + rnd() * 5, 3 + rnd() * 2, 0, 0, 6.28); g.fill(); g.restore(); } }); }
  _mapTexture() { return this._canvas(512, 384, (g, W, H) => { g.fillStyle = '#d8ceb0'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(80,110,70,.5)'; for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 60, 10 + rnd() * 30, rnd() * 3, 0, 6.28); g.stroke(); }
    g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.setLineDash([10, 6]); g.beginPath(); g.moveTo(60, 20); g.bezierCurveTo(140, 120, 120, 260, 220, 370); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#7a1a14'; for (let i = 0; i < 18; i++) { const t = i / 17; g.fillRect(70 + t * 150 + Math.sin(t * 9) * 12, 30 + t * 330, 8, 8); }
    g.fillStyle = '#1a2a5a'; g.font = 'bold 20px serif'; g.fillText('AACHEN', 300, 80); g.fillText('ROETGEN', 250, 250); g.fillText('STOLBERG', 330, 170); g.font = '14px serif'; g.fillText('Westwall', 120, 200); }); }
  _signTexture() { return this._canvas(256, 128, (g, W, H) => { g.fillStyle = '#e8e0c8'; g.fillRect(0, 0, W, H); g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(4, 4, W - 8, H - 8); g.fillStyle = '#9a1a14'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText('ACHTUNG', W / 2, 54); g.fillStyle = '#222'; g.font = 'bold 34px sans-serif'; g.fillText('MINEN!', W / 2, 100); }); }

  // ------------------------------------------------------------- 지형
  _terrain5() {
    const g = new THREE.PlaneGeometry(220, 320, 220, 320); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sa = new Float32Array(n * 4), sb = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), h = displayHeight(x, z); p.setY(i, h);
      let forest = forestAt(x, z), mud = 0, rock = 0, burn = 0, dry = 0;
      if (Math.abs(x - roadX(z)) < 2.4 && z > -60) mud = .85;
      if (trenchDist(x, z) < 2.6) mud = Math.max(mud, .9);
      if (x > HQ.ramp.x0 - 2 && x < HQ.ramp.x1 + 2 && z > -34 && z < -16) mud = .9;
      for (const [cx, cz, r] of CRATERS) { const d = Math.hypot(x - cx, z - cz); if (d < r * 1.5) burn = Math.max(burn, 1 - d / (r * 1.5)); }
      for (const B of BUNKERS) { const d = Math.hypot(x - B.x, z - B.z); if (d < 9) rock = Math.max(rock, .7 * (1 - d / 9)); }
      if (z < -20) dry = clamp((-20 - z) / 40, 0, .7);
      if (Math.hypot(x - FINAL.x, z - FINAL.z) < 16) rock = Math.max(rock, .5);
      forest *= .95; let s = forest + mud + rock + burn + dry; if (s > 1) { forest /= s; mud /= s; rock /= s; burn /= s; dry /= s; }
      sa[i * 4] = forest; sa[i * 4 + 1] = mud; sa[i * 4 + 2] = rock; sa[i * 4 + 3] = burn; sb[i * 2] = dry;
      const j = .9 + Math.random() * .1; col[i * 3] = j * 1.02; col[i * 3 + 1] = j; col[i * 3 + 2] = j * .9;   // 가을빛
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2)); g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, createTerrainMaterial(this.assets, LAYERS)); this.terrain.receiveShadow = true; this.scene.add(this.terrain); this.grassLayer = null;
  }

  // ------------------------------------------------------------- 공통
  _b(mat, w, h, d, x, y, z, ry = 0, tile = 1.6) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); PB.boxUV(g, tile); this._push(mat, g); }
  _push(mat, g) { (this.geo.get(mat) || this.geo.set(mat, []).get(mat)).push(g.index ? g.toNonIndexed() : g); }
  _flush() { for (const [mat, list] of this.geo) { if (!list.length) continue; for (const g of list) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); this.scene.add(new THREE.Mesh(mergeGeometries(list, false), mat)); } this.geo.clear(); }
  _hit(cx, cy, cz, sx, sy, sz, { collide = true, solid = true, surface = 'concrete' } = {}) {
    if (collide) colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
    if (solid) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.PM.dark); b.position.set(cx, cy, cz); b.visible = false; b.userData.surface = surface; this.scene.add(b); solids.push(b); }
  }
  _instanced(geo, mat, mats, shadow = true) { const im = new THREE.InstancedMesh(geo, mat, mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = shadow; im.receiveShadow = true; im.userData.keepShadow = true; im.computeBoundingSphere(); this.scene.add(im); return im; }
  /** 숲은 55m 칸마다 따로 그려 화면·그림자 밖의 칸은 건너뛴다 */
  _chunked(geo, mat, mats, shadow = true) { const tiles = new Map(), v = new V3(); for (const m of mats) { v.setFromMatrixPosition(m); const k = Math.floor(v.x / 55) + ',' + Math.floor(v.z / 55); (tiles.get(k) || tiles.set(k, []).get(k)).push(m); }
    for (const [k, list] of tiles) { const [tx, tz] = k.split(',').map(Number), x0 = tx * 55, z0 = tz * 55, inPlay = x0 + 55 > PLAYER_BOX.minX - 10 && x0 < PLAYER_BOX.maxX + 10 && z0 + 55 > PLAYER_BOX.minZ - 10 && z0 < PLAYER_BOX.maxZ + 10;
      this._instanced(geo, mat, list, shadow && inPlay); } }   // 놀이 구역 밖 칸의 나무는 그림자를 그리지 않는다(8단계 최적화)
  _lowBag() { if (!this._lb) { const g = new THREE.SphereGeometry(.5, 8, 4); g.scale(1, .8, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { p.setX(i, Math.sign(p.getX(i)) * Math.min(.5, Math.abs(p.getX(i)) * 1.25)); p.setZ(i, Math.sign(p.getZ(i)) * Math.min(.5, Math.abs(p.getZ(i)) * 1.25)); } g.computeVertexNormals(); this._lb = g; } return this._lb; }
  _bagGeo() { return this._bg || (this._bg = this._modelGeometry('props.sandbag', (g) => { g.rotateY(Math.PI / 2); const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new V3()), c = b.getCenter(new V3()); g.translate(-c.x, -c.y, -c.z); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z); }) || new THREE.SphereGeometry(.5, 10, 7)); }
  _bagLine(x0, z0, x1, z1, rows, out, base = null) { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / .62)), a = Math.atan2(x1 - x0, z1 - z0);
    for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) { const t = (i + .5 + (r % 2) * .25) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = (base ?? surface(x, z)) + .13 + r * .26; out.push(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + Math.PI / 2, 0)), new V3(.74, .34, .62))); } }

  // ------------------------------------------------------------- 숲
  _forest() {
    const spruce = [], beech = [], trunks = [], P = this.P5;
    for (let x = -108; x < 108; x += 4.2) for (let z = -158; z < 158; z += 4.2) {
      const px = x + rr(-1.8, 1.8), pz = z + rr(-1.8, 1.8), f = forestAt(px, pz); if (rnd() > f) continue;
      if (trenchDist(px, pz) < 4 || (Math.abs(pz - 14) < 5) || (px > HQ.x0 - 3 && px < HQ.x1 + 3 && pz > HQ.z0 - 3 && pz < -16)) continue;
      const y = displayHeight(px, pz), s = rr(.8, 1.25), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0));
      if (rnd() < .72) { spruce.push(new THREE.Matrix4().compose(new V3(px, y - .2, pz), q, new V3(s, s * rr(.9, 1.2), s))); trunks.push(new THREE.Matrix4().compose(new V3(px, y + 2 * s, pz), q, new V3(.3 * s, 4 * s, .3 * s))); }
      else { beech.push(new THREE.Matrix4().compose(new V3(px, y + 6 * s, pz), q, new V3(s, s, s))); trunks.push(new THREE.Matrix4().compose(new V3(px, y + 3.2 * s, pz), q, new V3(.36 * s, 6.6 * s, .36 * s))); }
      // 줄기 판정(놀이 구역 안만)
      if (px > PLAYER_BOX.minX - 4 && px < PLAYER_BOX.maxX + 4 && pz > PLAYER_BOX.minZ - 4 && pz < PLAYER_BOX.maxZ + 4) { colliders.push({ minX: px - .35 * s, maxX: px + .35 * s, minZ: pz - .35 * s, maxZ: pz + .35 * s, minY: y - 1, maxY: y + 8 }); this._hit(px, y + 3, pz, .45 * s, 6, .45 * s, { collide: false, surface: 'wood' }); }
    }
    // 가문비나무: 원뿔 다섯 겹(아래가 넓음)
    const cones = []; for (let k = 0; k < 5; k++) { const r = 2.3 - k * .42, h = 3.4 - k * .35, c = new THREE.ConeGeometry(r, h, 9, 1, true); c.translate(0, 2.4 + k * 2.1 + h / 2, 0); cones.push(c.toNonIndexed()); }
    const sg = mergeGeometries(cones, false); PB.boxUV(sg, 1.4);
    this._chunked(sg, new THREE.MeshStandardMaterial({ map: P.spruce.map, roughness: .95, side: THREE.DoubleSide }), spruce);
    const bg = mergeGeometries([0, 1, 2, 3].map((k) => { const g = new THREE.IcosahedronGeometry(2.3 - k * .2, 0); g.translate(Math.cos(k * 1.7) * 1.4, k * .7 - .6, Math.sin(k * 1.7) * 1.4); return g.toNonIndexed(); }), false); PB.boxUV(bg, 1.3);
    this._chunked(bg, P.beech, beech);
    this._chunked(new THREE.CylinderGeometry(.5, .7, 1, 6, 1, true), P.bark, trunks, false);   // 줄기 그림자는 수관 그림자에 묻혀 거의 안 보임
    this.treeCount = spruce.length + beech.length;
  }

  // ------------------------------------------------------------- 야전 방어선
  _trenches() {
    const bags = [], boards = [];
    for (let i = 0; i < TRENCH.length - 1; i++) {
      const [x0, z0] = TRENCH[i], [x1, z1] = TRENCH[i + 1], L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L, sgn = nz < 0 ? 1 : -1;   // 북쪽(적 뒤) 방향으로 흙을 쌓고, 남쪽 앞에 모래주머니
      this._bagLine(x0 - nx * 2.1 * sgn, z0 - nz * 2.1 * sgn, x1 - nx * 2.1 * sgn, z1 - nz * 2.1 * sgn, 2, bags);
      // 참호 벽 판자(양쪽)
      { const g = PB.trenchRevetment(L); g.scale(1, 1, 1.72); g.rotateY(Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2); const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; g.translate(mx, surface(mx, mz) - 1.25, mz); boards.push(g); }
    }
    this._chunked(this._lowBag(), this.M.bag, bags);   // 참호 모래주머니는 수백 개라 단순한 모양으로
    const bm = new THREE.Mesh(mergeGeometries(boards.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; }), false), this.PM.wood); this.scene.add(bm);
    // 참호 앞 흙더미 판정(엎드려 숨을 수 있는 높이)
    for (let i = 0; i < TRENCH.length - 1; i++) { const [x0, z0] = TRENCH[i], [x1, z1] = TRENCH[i + 1]; for (let t = .1; t < 1; t += .2) { const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t + 2.1; this._hit(x, surface(x, z) + .3, z, Math.abs(x1 - x0) * .2 + .6, .6, .7, { collide: false, surface: 'sand' }); } }
    // MG42 두 정(참호 속, 모래주머니 위)
    this.mgSpots = [{ x: -20, z: 28.2 }, { x: 22, z: 32.6 }];
    for (const s of this.mgSpots) { const mg = PB.mg42Geometry(); for (const [geo, mat] of [[mg.steel, this.PM.gun], [mg.wood, this.PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(s.x, surface(s.x, s.z) + .3, s.z + 1.6); this.scene.add(m); } }
    // 지뢰 경고판
    for (const [x, z] of [[-60, 42], [-10, 41], [46, 41], [64, 20]]) { this._b(this.PM.wood, .1, 1.3, .1, x, surface(x, z) + .65, z); const s = new THREE.Mesh(new THREE.PlaneGeometry(.8, .4), this.P5.sign); s.position.set(x, surface(x, z) + 1.2, z + .06); this.scene.add(s); }
  }
  _wires() {
    const lines = [[[-72, WIRE_Z], [-41, WIRE_Z + 1]], [[-35, WIRE_Z], [-2, WIRE_Z - 1]], [[7, WIRE_Z - 1], [29, WIRE_Z]], [[35, WIRE_Z], [72, WIRE_Z + 1]], [[-72, 20], [-40, 20]], [[-32, 20], [roadX(20) - 3.5, 20]], [[roadX(20) + 3.5, 20], [72, 20]]];
    for (const [a, b] of lines) { const w = PB.barbedWire(new V3(a[0], 0, a[1]), new V3(b[0], 0, b[1]), heightAt), m1 = new THREE.Mesh(w.wire, this.PM.wire), m2 = new THREE.Mesh(w.posts, this.PM.wood); m1.userData.noShadow = true; this.scene.add(m1, m2);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 4) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; colliders.push({ minX: x - 2.1, maxX: x + 2.1, minZ: z - .5, maxZ: z + .5, minY: surface(x, z) - 1, maxY: surface(x, z) + 1 }); } }
  }
  /** 용의 이빨: 위가 잘린 콘크리트 피라미드 4줄, 길목과 폭파된 틈만 비움 */
  _teeth() {
    const T = TEETH, mats = [], tg = new THREE.CylinderGeometry(.18, .72, 1, 4, 1); tg.rotateY(Math.PI / 4); tg.translate(0, .5, 0); PB.boxUV(tg, 1.2);
    for (let r = 0; r < T.rows; r++) {
      const z = T.z0 + r * 1.6, h = .9 + r * .15; let seg = null;
      const close = () => { if (seg && seg.x1 > seg.x0) { const cx = (seg.x0 + seg.x1) / 2, y = surface(cx, z); this._hit(cx, y + h / 2 - .1, z, seg.x1 - seg.x0 + 1.2, h + .4, 1.2); } seg = null; };
      for (let x = -76 + (r % 2) * .8; x < 76; x += T.gap) {
        const road = Math.abs(x - roadX(z)) < 3.2, breach = x > T.breach[0] && x < T.breach[1];
        if (road) { close(); continue; }
        const y = surface(x, z);
        if (breach) { close(); if (rnd() < .45) mats.push(new THREE.Matrix4().compose(new V3(x + rr(-.6, .6), y - .2, z + rr(-1, 1)), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-1.2, 1.2), rnd() * 3, rr(-1.2, 1.2))), new V3(.8, h * .6, .8))); continue; }
        mats.push(new THREE.Matrix4().compose(new V3(x, y - .1, z), new THREE.Quaternion(), new V3(1, h, 1)));
        if (!seg) seg = { x0: x, x1: x }; else seg.x1 = x;
      }
      close();
    }
    this._instanced(tg, this.P5.tooth, mats);
    // 길목: 체코 고슴도치 3개 + 넘어진 차단봉(사람 한 명 지나갈 틈)
    const hh = PB.hedgehogGeometry(), hm = [];
    for (const [dx, dz] of [[-2.2, 13.5], [2.4, 15], [-.6, 17.2]]) { const z = dz, x = roadX(z) + dx, y = surface(x, z); hm.push(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 3, 0)), new V3(1, 1, 1))); this._hit(x, y + .7, z, 1.6, 1.4, 1.6, { surface: 'metal' }); }
    this._instanced(hh, this.PM.rust, hm);
  }
  // ------------------------------------------------------------- 벙커 2곳(총안구 MG)
  _bunkers() {
    BUNKERS.forEach((B, i) => {
      const y = surface(B.x, B.z) - .1, bp = PB.bunkerParts(B.W, B.D, B.H, [1.05, 1.75]);
      const con = new THREE.Mesh(bp.concrete, this.PM.concrete), earth = new THREE.Mesh(bp.earth, this.PM.mound), dark = new THREE.Mesh(bp.dark, this.PM.dark);
      for (const m of [con, earth, dark]) { m.position.set(B.x, y, B.z); this.scene.add(m); }
      con.userData.dynamic = true; this.bunkerMeshes[i] = con;
      const T = .6, fz = B.z + B.D / 2 - T / 2, W = B.W, H = B.H;
      colliders.push({ minX: B.x - W / 2, maxX: B.x + W / 2, minZ: B.z - B.D / 2 - 1, maxZ: B.z + B.D / 2, minY: y - 1, maxY: y + H + 1 });
      const s = (cx, cy, cz, sx, sy, sz) => this._hit(cx, cy, cz, sx, sy, sz, { collide: false });
      s(B.x, y + .52, fz, W, 1.05, T); s(B.x, y + (H + 1.75) / 2, fz, W, H - 1.75, T); s(B.x - 2.5, y + 1.4, fz, 3, .7, T); s(B.x + 2.5, y + 1.4, fz, 3, .7, T);
      s(B.x - W / 2 + .3, y + H / 2, B.z, T, H, B.D); s(B.x + W / 2 - .3, y + H / 2, B.z, T, H, B.D); s(B.x, y + H / 2, B.z - B.D / 2 + .3, W, H, T); s(B.x, y + H + .4, B.z, W + .8, .8, B.D + 1);
      B.slit = new V3(B.x, y + 1.4, B.z + B.D / 2); B.y = y;
    });
  }
  /** 벙커가 부서진 모습: 콘크리트가 그을리고 연기가 난다 */
  breakBunker(i) { const m = this.bunkerMeshes[i]; if (!m) return; m.material = this._burntConcrete || (this._burntConcrete = this.PM.concrete.clone()); this._burntConcrete.color.setRGB(.32, .3, .28); const B = BUNKERS[i]; this.smokeSources.push([B.x, B.z + 2]); }
  _mortar() {
    const P = this.PM, M = MORTAR, y = surface(M.x, M.z), bags = [];
    for (let a = 0; a < 6.2; a += .42) { const x = M.x + Math.cos(a) * 2.4, z = M.z + Math.sin(a) * 2.4; for (let r = 0; r < 2; r++) bags.push(new THREE.Matrix4().compose(new V3(x, y + .13 + r * .26, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)), new V3(.74, .34, .62))); }
    this._instanced(this._bagGeo(), this.M.bag, bags);
    const g = new THREE.Group(), steel = P.gun, tube = new THREE.Mesh(new THREE.CylinderGeometry(.06, .065, 1.25, 12), steel); tube.position.set(0, .6, 0); tube.rotation.x = .75; g.add(tube);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, .06, 14), steel); plate.position.set(0, .05, -.3); g.add(plate);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .85, 6), steel); leg.position.set(s * .18, .38, .24); leg.rotation.set(-.35, 0, s * .3); g.add(leg); }
    g.position.set(M.x, y, M.z); g.userData.dynamic = true; g.userData.tube = tube; this.scene.add(g); this.mortarGroup = g;
    for (const [x, z] of [[1, 1.2], [-1.2, 1.1]]) { const m = this.assets.instantiate('decor.ammobox'); if (m) { m.position.set(M.x + x, y, M.z + z); this.scene.add(m); } }
  }
  breakMortar() { const t = this.mortarGroup.userData.tube; t.rotation.set(1.5, 0, .6); t.position.y = .12; this.mortarGroup.updateMatrixWorld(true); }
  _sniperStands() {
    for (const S of SNIPER_STANDS) { const y = surface(S.x, S.z), top = y + S.h;
      this._b(this.PM.wood, 2.2, .14, 2.2, S.x, top, S.z, 0, 1.2);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this._b(this.PM.wood, .14, S.h, .14, S.x + dx, y + S.h / 2, S.z + dz, 0, 1.2);
      for (const e of [-1, 1]) this._b(this.PM.wood, 2.2, .6, .06, S.x, top + .4, S.z + e * 1.08, 0, 1.2);   // 난간
      for (let k = .5; k < S.h; k += .45) this._b(this.PM.wood, .7, .06, .06, S.x, y + k, S.z + 1.25);   // 사다리
      this._hit(S.x, top - .05, S.z, 2.2, .14, 2.2, { collide: false, surface: 'wood' });
    }
  }

  // ------------------------------------------------------------- 지하 지휘 벙커
  _wall(axis, a, b, fixed, y, h, t, mat, openings = [], hit = true) {
    const seg = (s0, s1, y0, y1) => { if (s1 - s0 < .02 || y1 - y0 < .02) return; const L = s1 - s0, m = (s0 + s1) / 2;
      if (axis === 'x') { this._b(mat, L, y1 - y0, t, m, y + (y0 + y1) / 2, fixed); if (hit) this._hit(m, y + (y0 + y1) / 2, fixed, L, y1 - y0, t, { collide: y0 < 1.2 }); }
      else { this._b(mat, t, y1 - y0, L, fixed, y + (y0 + y1) / 2, m); if (hit) this._hit(fixed, y + (y0 + y1) / 2, m, t, y1 - y0, L, { collide: y0 < 1.2 }); } };
    const ops = [...openings].sort((p, q) => p.c - q.c); let s = a;
    for (const o of ops) { seg(s, o.c - o.w / 2, 0, h); seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0); seg(o.c - o.w / 2, o.c + o.w / 2, o.y1, h); s = o.c + o.w / 2; }
    seg(s, b, 0, h);
  }
  _hq() {
    const P = this.P5, C = this.PM.concrete, R = HQ.ramp, D = (w) => ({ c: 0, w, y0: 0, y1: 2.2 });
    // 경사로 양쪽 옹벽(위로 30cm 솟음) + 입구 위 콘크리트 면
    for (let z = R.z0; z < R.z1; z += 1) { const zc = z + .5, floor = displayHeight(5, zc), top = surface(5, zc) + .35, h = top - floor + .2;
      for (const x of [R.x0 - .5, R.x1 + .5]) { this._b(C, 1, h, 1.02, x, floor - .2 + h / 2, zc, 0, 2); this._hit(x, floor - .2 + h / 2, zc, 1, h, 1); } }
    const sTop = surface(5, HQ.z1) + .6;
    this._wall('x', HQ.x0 - .5, HQ.x1 + .5, HQ.z1 + .25, F, sTop - F, .5, C, [{ c: HQ.door.x, w: 1.6, y0: 0, y1: 2.2 }]);
    // 바깥벽(안쪽에서 보이는 면)
    this._wall('x', HQ.x0, HQ.x1, HQ.z1 - .3, F, CEIL, .1, P.inner, [{ c: HQ.door.x, w: 1.6, y0: 0, y1: 2.2 }], false);
    this._wall('x', HQ.x0, HQ.x1, HQ.z0 + .2, F, CEIL, .4, P.inner);
    this._wall('z', HQ.z0, HQ.z1, HQ.x0 + .2, F, CEIL, .4, P.inner); this._wall('z', HQ.z0, HQ.z1, HQ.x1 - .2, F, CEIL, .4, P.inner);
    // 안쪽: 복도(x 4~6) | 서쪽 막사 | 동쪽 지휘실(앞)·탄약고(뒤)
    this._wall('z', HQ.z0 + .4, HQ.z1 - .3, 3.8, F, CEIL, .3, P.inner, [{ c: -38, w: 1.2, y0: 0, y1: 2.1 }, { c: -49.5, w: 1.2, y0: 0, y1: 2.1 }]);
    this._wall('z', HQ.z0 + .4, HQ.z1 - .3, 6.2, F, CEIL, .3, P.inner, [{ c: -36, w: 1.2, y0: 0, y1: 2.1 }, { c: -49.5, w: 1.2, y0: 0, y1: 2.1 }]);
    this._wall('x', 6.35, HQ.x1 - .4, -42, F, CEIL, .3, P.inner);
    // 바닥·천장(천장은 총알을 막고 햇빛을 가린다)
    this._b(P.floor, HQ.x1 - HQ.x0, .1, HQ.z1 - HQ.z0, (HQ.x0 + HQ.x1) / 2, F - .05, (HQ.z0 + HQ.z1) / 2, 0, 2);
    this._b(P.inner, HQ.x1 - HQ.x0 + 1, .5, HQ.z1 - HQ.z0 + 1, (HQ.x0 + HQ.x1) / 2, F + CEIL + .25, (HQ.z0 + HQ.z1) / 2, 0, 2);
    this._hit((HQ.x0 + HQ.x1) / 2, F + CEIL + .25, (HQ.z0 + HQ.z1) / 2, HQ.x1 - HQ.x0 + 1, .5, HQ.z1 - HQ.z0 + 1, { collide: false });
    // 덮인 땅 위로는 걸어 들어가지 못하게(지하에 있는 사람 키보다 높은 곳부터 막음)
    colliders.push({ minX: HQ.x0 - .2, maxX: HQ.x1 + .2, minZ: HQ.z0 - .2, maxZ: HQ.z1, minY: F + CEIL + .1, maxY: HQ_SURF_MAX + 6, walkOnly: true });   // walkOnly: 사람만 막고 수류탄은 통과(덮인 땅 위로 떨어짐)
    // 천장 전등(빛나는 갓)
    for (const [x, z] of [[5, -35], [5, -44], [5, -50.5], [-1, -37], [-1, -47], [11, -37], [11, -47]]) { this._b(P.lamp, .3, .12, .3, x, F + CEIL - .1, z); this._b(this.PM.gun, .04, .3, .04, x, F + CEIL - .25 + .25, z); }
    // 지휘실: 작전 지도 탁자·무전기·의자·지도 벽
    const drop = (key, x, z, fit, ry = 0) => { const m = this.assets.instantiate(key, fit ? { fit } : {}); if (m) { m.position.set(x, F, z); m.rotation.y = ry; this.scene.add(m); } return m; };
    drop('props.table', 11, -37, [2.2, .8, 1.3]); const map = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), P.map); map.rotation.x = -Math.PI / 2; map.position.set(11, F + .83, -37); this.scene.add(map);
    const r = drop('props.radio', 15, -34.2, [.6, .45, .35], Math.PI); if (r) r.position.y = F + .8; drop('props.table', 15, -34.2, [1.2, .78, .7]);
    for (const [x, z, ry] of [[10, -35.6, 0], [12.2, -38.4, 2.8], [14.3, -35.6, 3.1]]) drop('props.chair', x, z, null, ry);
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), P.map); wm.position.set(11, F + 1.6, -41.8); this.scene.add(wm);
    // 탄약고: 상자·탄약통
    for (const [x, z] of [[8, -51], [9.1, -51], [8, -49.9], [14.8, -51], [14.8, -49.8], [13.6, -51]]) drop('props.crate', x, z, [1, .7, .9]);
    for (const [x, z] of [[11, -51.2], [12, -51.3], [11.5, -43]]) drop('decor.ammobox', x, z);
    // 막사: 2층 침대
    for (const z of [-34, -37.5, -44.5, -48]) for (const lvl of [0, 1]) { this._b(P.plank, 1.9, .12, .9, -4.6, F + .45 + lvl * 1.1, z); for (const dx of [-.9, .9]) this._b(this.PM.wood, .07, 2.1, .07, -4.6 + dx, F + 1.05, z + .4); }
    this._b(P.plank, 1.4, .08, .8, 1.2, F + .75, -41.5); this._hit(-4.6, F + .8, -41, 1.9, 1.6, 15, { collide: true, solid: false });
    // 입구 위 위장 그물 기둥·문짝
    this._b(this.PM.rust, .08, 2.2, 1.0, HQ.door.x + 1.1, F + 1.1, HQ.z1 + .8, -.5);
  }
  // ------------------------------------------------------------- 마지막 요새(언덕 꼭대기 관측 벙커)
  _final() {
    const y = surface(FINAL.x, FINAL.z) - .1, W = 10, D = 7, H = 3, bp = PB.bunkerParts(W, D, H, [1.1, 1.8]), z = FINAL.z + 2;
    for (const [geo, mat] of [[bp.concrete, this.PM.concrete], [bp.earth, this.PM.mound], [bp.dark, this.PM.dark]]) { const m = new THREE.Mesh(geo, mat); m.position.set(FINAL.x, y, z); this.scene.add(m); }
    colliders.push({ minX: FINAL.x - W / 2, maxX: FINAL.x + W / 2, minZ: z - D / 2 - 1, maxZ: z + D / 2, minY: y - 1, maxY: y + H + 1 });
    const fz = z + D / 2 - .3, s = (cx, cy, cz, sx, sy, sz) => this._hit(cx, cy, cz, sx, sy, sz, { collide: false });
    s(FINAL.x, y + .55, fz, W, 1.1, .6); s(FINAL.x, y + (H + 1.8) / 2, fz, W, H - 1.8, .6); s(FINAL.x - 3, y + 1.45, fz, 4, .7, .6); s(FINAL.x + 3, y + 1.45, fz, 4, .7, .6); s(FINAL.x, y + H / 2, z, W, H, D - 1);
    this.finalSlit = new V3(FINAL.x, y + 1.45, z + D / 2); this.finalY = y;
    // 둘레의 모래주머니 진지 + 전망 자리(독일 쪽, 북쪽 끝)
    const bags = []; this._bagLine(FINAL.x - 12, FINAL.z + 8, FINAL.x - 4, FINAL.z + 11, 3, bags); this._bagLine(FINAL.x + 4, FINAL.z + 11, FINAL.x + 13, FINAL.z + 7, 3, bags); this._bagLine(FINAL.x - 4, FINAL.z - 9, FINAL.x + 4, FINAL.z - 9, 2, bags);
    this._instanced(this._bagGeo(), this.M.bag, bags);
    for (const [x0, z0, x1, z1] of [[FINAL.x - 12, FINAL.z + 8, FINAL.x - 4, FINAL.z + 11], [FINAL.x + 4, FINAL.z + 11, FINAL.x + 13, FINAL.z + 7]]) { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; this._hit(cx, surface(cx, cz) + .4, cz, Math.abs(x1 - x0) + .5, .8, Math.abs(z1 - z0) + .6, { surface: 'sand' }); }
    const mg = PB.mg42Geometry(); for (const [geo, mat] of [[mg.steel, this.PM.gun], [mg.wood, this.PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(FINAL.x, y + 1.35, z + D / 2 - .7); this.scene.add(m); }
  }
  // ------------------------------------------------------------- 차량
  _vehicles() {
    const P = this.P5, PM = this.PM;
    // Sd.Kfz.251 하프트랙(지휘 벙커 입구 옆)
    const ht = new THREE.Group(), side = new THREE.Shape(); side.moveTo(-2.9, .55); side.lineTo(1.6, .55); side.lineTo(2.9, 1.05); side.lineTo(2.6, 1.55); side.lineTo(.9, 1.85); side.lineTo(-2.9, 1.85); side.closePath();
    const hull = new THREE.ExtrudeGeometry(side, { depth: 2.1, bevelEnabled: false }); hull.translate(0, 0, -1.05); hull.rotateY(-Math.PI / 2); PB.boxUV(hull, 1.5); ht.add(new THREE.Mesh(hull, P.grey));
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(PB.roundedBox(.35, .65, 3.4, .1), P.tyre); tr.position.set(s * .95, .42, -1.1); ht.add(tr); const wh = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .22, 12), P.tyre); wh.rotation.z = Math.PI / 2; wh.position.set(s * .95, .42, 2.1); ht.add(wh); }
    const hx = 11, hz = -22; ht.position.set(hx, surface(hx, hz), hz); ht.rotation.y = .4; this.scene.add(ht); this._hit(hx, surface(hx, hz) + 1, hz, 3.2, 2, 6, { surface: 'metal' });
    // 오펠 블리츠 트럭(길가)
    const tk = new THREE.Group(), add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); tk.add(m); return m; };
    add(PB.roundedBox(1.7, .9, 1.6, .2), P.grey, 0, 1.25, 2.1); add(PB.roundedBox(2.1, 1.3, 1.4, .12), P.grey, 0, 1.6, .9); add(PB.roundedBox(2.3, 1.5, 3.6, .1), P.olive, 0, 1.8, -1.4);
    for (const [x, z] of [[-1, 2.1], [1, 2.1], [-1, -1.9], [1, -1.9]]) { const w = add(new THREE.CylinderGeometry(.48, .48, .3, 14), P.tyre, x, .48, z); w.rotation.z = Math.PI / 2; }
    const tx = roadX(-64) + 3.5, tz = -64; tk.position.set(tx, surface(tx, tz), tz); tk.rotation.y = -.15; this.scene.add(tk); this._hit(tx, surface(tx, tz) + 1.3, tz, 2.6, 2.6, 6.2, { surface: 'metal' });
    // 풀밭에서 불타는 셔먼(앞서 간 아군 전차)
    const s = PB.shermanParts(), sx = -14, sz = 46, sy = surface(sx, sz);
    for (const [geo, mat] of [[s.hull, PM.tank], [s.track, PM.burnt], [s.wheel, PM.burnt]]) { const m = new THREE.Mesh(geo, mat); m.position.set(sx, sy - .1, sz); m.rotation.y = 2.6; this.scene.add(m); }
    this._hit(sx, sy + 1.2, sz, 4, 2.4, 6.6, { surface: 'metal' });
  }
  // ------------------------------------------------------------- 언덕 너머 독일 본토(멀리)
  _germany() {
    const P = this.P5, G0 = 4.6;
    // 골짜기 바닥(지형 판 너머까지 이어지는 낮은 들판) + 들판 띠
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 420).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5c5a3a })); ground.position.set(0, G0, -360); ground.userData.noShadow = true; this.scene.add(ground);
    for (let i = 0; i < 14; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(rr(30, 70), rr(14, 30)).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: [0x6a6a3c, 0x4e5a34, 0x7a6a44, 0x5a4a32][i % 4] })); f.position.set(rr(-200, 200), G0 + .05, rr(-175, -300)); f.rotation.y = rr(-.3, .3); this.scene.add(f); }
    // 먼 구릉(침엽수 숲으로 덮인 아이펠 산지)
    for (let i = 0; i < 11; i++) { const m = new THREE.Mesh(PB.mound(rr(60, 120), rr(18, 40), rr(30, 60), i * 3 + 1), P.far); m.position.set(-320 + i * 64 + rr(-15, 15), G0 - 4, -300 - (i % 3) * 40 - rr(0, 20)); m.userData.noShadow = true; this.scene.add(m); }
    // 마을 셋(교회 첨탑)과 그 사이 길
    for (const [vx, vz] of [[-60, -190], [50, -215], [-10, -250]]) {
      for (let k = 0; k < 14; k++) { const x = vx + rr(-20, 20), z = vz + rr(-12, 12), w = rr(5, 8), d = rr(4, 7), h = rr(4, 6); this._b(P.farHouse, w, h, d, x, G0 + h / 2, z); const roof = new THREE.ConeGeometry(Math.max(w, d) * .75, 3.2, 4); roof.rotateY(Math.PI / 4); roof.translate(x, G0 + h + 1.6, z); this._push(P.farRoof, roof); }
      this._b(P.farHouse, 5, 16, 5, vx, G0 + 8, vz - 4); const sp = new THREE.ConeGeometry(3, 11, 4); sp.rotateY(Math.PI / 4); sp.translate(vx, G0 + 21.5, vz - 4); this._push(P.farRoof, sp);
    }
    const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 160).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7a7060 })); road.position.set(-5, G0 + .08, -230); road.rotation.y = .25; this.scene.add(road);
  }
}
