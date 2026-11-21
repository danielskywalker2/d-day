// Stage 3 전장 그래픽 — 코브라 작전: 융단 폭격으로 파인 들판과 폐허가 된 노르망디 마을(교차로).
// 무너진 석조 집(창문·문·포탄 구멍·들쭉날쭉한 윗선·내려앉은 2층 바닥·잔해 더미), 반쯤 무너진 성당, 면사무소(지휘 거점),
// 불타는 독일군 트럭·하프트랙, 파괴된 4호 전차, 아군 셔먼, Pak 40 대전차포, 기관총 진지, 전신주, 부러진 나무.
// 집은 0.75m 폭의 세로 기둥 조각으로 벽을 만들고(그래서 구멍·무너짐이 자연스럽다) 재질별로 한 메시로 합친다.
// 사격·이동 판정은 같은 모양을 큰 덩어리로 묶은 보이지 않는 상자 — 창문·포탄 구멍으로는 쏠 수 있다.
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/jsm/utils/BufferGeometryUtils.js';
import { EnvironmentManager } from '../../graphics/EnvironmentManager.js';
import { createTerrainMaterial } from '../../graphics/TerrainMaterial.js';
import { InstanceLOD } from '../../graphics/InstanceLOD.js';
import * as PB from '../../graphics/PropBuilder.js';
import { heightAt, solids, colliders } from '../../game/world.js';
import { V3, clamp } from '../../core/utils.js';
import { HOUSES, CP, CP_ROOM, CHURCH, WRECKS, MG_NESTS, AT_GUNS, RALLY, CRATERS3, ROAD_X, CROSS_Z } from './layout.js';
import { TOWN_H } from './terrain.js';

const LAYERS = [
  { name: 'leafy_grass', tile: 3.4, rough: .95 },       // 0 풀밭
  { name: 'cobblestone_01', tile: 2.2, rough: .8 },     // 1 마을 도로(돌길)
  { name: 'muddy_tracks', tile: 3.2, rough: .75 },      // 2 흙길·뒤집힌 흙
  { name: 'brick_gravel', tile: 2.4, rough: .9 },       // 3 무너진 집 둘레의 잔해
  { name: 'burned_ground_01', tile: 3.0, rough: .95 },  // 4 그을린 땅
  { name: 'brown_mud', tile: 2.6, rough: .65 },         // 5 구덩이 바닥 진흙
];
const FH = 3.0, WT = .45;   // 층 높이, 벽 두께
let seed = 7251944; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const rr = (a, b) => a + rnd() * (b - a);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class RuinedTownEnvironment extends EnvironmentManager {
  constructor(deps) {
    super(deps); this.stageId = 3;
    // 연기 기둥: 불타는 차량 + 불타는 집 2채. 불빛(점광원)은 앞의 3곳만(성능)
    const burning = WRECKS.filter((w) => w.burning).map((w) => [w.x, w.z]);
    this.smokeSources = [...burning, [-12, -36], [40, -30]];
    this.fireSources = this.smokeSources.slice(0, 3);
  }

  build() {
    this.lods = []; this.gfxSwap = [];
    this.PM = this._materials(); this._stage3Materials();
    this._terrain3();
    this._skyAndWater(); this.water.visible = false;
    this.geo = new Map();   // 재질 → 합칠 지오메트리 목록(건물 조각)
    for (const h of HOUSES) this._ruin(h);
    this._church(); this._townHall();
    this._flushGeo();
    this._vehicles(); this._guns(); this._bombZone(); this._streetProps();
    this._groundCover3();
    const lodMeshes = new Set(); for (const l of this.lods) for (const L of l.levels) for (const im of [L.near, L.mid, L.far]) if (im) lodMeshes.add(im);
    this.scene.traverse((o) => { if (o.isMesh && !lodMeshes.has(o) && !o.userData.keepShadow && o !== this.terrain && o !== this.water && o !== this.sky) { o.castShadow = o.visible && !o.userData.noShadow; o.receiveShadow = true; } });
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => { if (o !== this.scene && o !== this.sky && o !== this.water && !o.isLight && o !== this.lighting.sun.target && !o.userData.dynamic) o.matrixAutoUpdate = false; });
    for (const l of this.lods) l.update(new V3(0, 2, 96), true);
  }

  _stage3Materials() {
    const a = this.assets, S = (o) => new THREE.MeshStandardMaterial(o);
    this.P3 = {
      wall: S({ color: 0xe6ded2, ...a.pbr('damaged_plaster', .4, .4) }),                                          // 바깥: 회칠이 떨어져 벽돌이 드러난 벽
      inner: S({ color: new THREE.Color(0xd8cfc0).multiplyScalar(2.6), ...a.pbr('plastered_stone_wall', .45, .45) }),   // 안쪽: 원본 텍스처가 아주 어두워 밝게 보정
      brick: S({ color: 0xc4a894, ...a.pbr('brick_wall_001', .6, .6) }),
      stone: S({ color: 0xcfc8bc, ...a.pbr('rustic_stone_wall', .4, .4) }),
      rubble: S({ color: 0xb8ab9c, ...a.pbr('brick_gravel', .5, .5) }),
      slate: S({ color: 0xa8acb0, ...a.pbr('grey_roof_tiles', .5, .5) }),
      beam: S({ color: 0x5e4a38, ...a.pbr('weathered_planks', .5, .5) }),
      floor: S({ color: 0x8c7a66, ...a.pbr('weathered_planks', .5, .5) }),
      charred: S({ color: 0x2a2622, roughness: 1 }),
      greyTank: S({ color: new THREE.Color(0x6a6e70).multiplyScalar(1.8), metalness: .4, ...a.pbr('rusty_metal_02', .6, .6) }),
      canvas: S({ color: 0x5a5a44, roughness: 1 }),
      paper: S({ color: 0xd8cfb4, roughness: 1 }),
    };
  }

  // ------------------------------------------------------------- 지형
  _terrain3() {
    const W = 168, D = 222, g = new THREE.PlaneGeometry(W, D, 168, 222); g.rotateX(-Math.PI / 2); g.translate(0, 0, 6);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sa = new Float32Array(n * 4), sb = new Float32Array(n * 2);
    const noise = (x, z) => Math.sin(x * .37 + z * .21) * .5 + Math.sin(x * .13 - z * .29 + 2.) * .5;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
      const nz = noise(x, z), town = z < 22;
      let cobble = 0, dirt = 0, rubble = 0, burn = 0, mud = 0;
      const onNS = Math.abs(x - ROAD_X) < 3.6, onEW = Math.abs(z - CROSS_Z) < 3.6 && Math.abs(x) < 70;
      if (town && (onNS || onEW)) cobble = .95; else if (onNS) dirt = .9;
      if (!town) dirt = Math.max(dirt, clamp(.3 + nz * .35, 0, .7) * ss(28, 40, z));   // 폭격으로 뒤집힌 흙
      for (const H of HOUSES) { const d = Math.max(Math.abs(x - H.x) - H.w / 2, Math.abs(z - H.z) - H.d / 2); if (d < 4) rubble = Math.max(rubble, (1 - Math.max(0, d) / 4) * (.4 + H.dmg * .6)); }
      for (const c of CRATERS3) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r * 1.6) { burn = Math.max(burn, clamp(1 - d / (c.r * 1.5), 0, 1) * .8); mud = Math.max(mud, clamp(1 - d / (c.r * .75), 0, 1) * .9); } }
      for (const w of WRECKS) { const d = Math.hypot(x - w.x, z - w.z); if (d < 6) burn = Math.max(burn, (1 - d / 6) * .9); }
      if (cobble) { rubble *= .4; mud *= .3; }
      let s = cobble + dirt + rubble + burn + mud; if (s > 1) { cobble /= s; dirt /= s; rubble /= s; burn /= s; mud /= s; }
      sa[i * 4] = cobble; sa[i * 4 + 1] = dirt; sa[i * 4 + 2] = rubble; sa[i * 4 + 3] = burn; sb[i * 2] = mud;
      const j = .9 + Math.random() * .1, gW = clamp(1 - cobble - dirt - rubble - burn - mud, 0, 1);
      col[i * 3] = j * (1 - .16 * gW); col[i * 3 + 1] = j * (1 + .02 * gW); col[i * 3 + 2] = j * (1 - .3 * gW);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2)); g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, createTerrainMaterial(this.assets, LAYERS)); this.terrain.receiveShadow = true; this.scene.add(this.terrain); this.grassLayer = null;
  }

  // ------------------------------------------------------------- 건물 조각 모으기
  _box(mat, w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); PB.boxUV(g, 1.6); (this.geo.get(mat) || this.geo.set(mat, []).get(mat)).push(g); }
  _flushGeo() { for (const [mat, list] of this.geo) { const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false), mat); this.scene.add(m); } this.geo.clear(); }
  /** 보이지 않는 판정 상자. collide = 이동 막음, solid = 총알·시야 막음 */
  _hit(cx, cy, cz, sx, sy, sz, { collide = true, solid = true, surface = 'concrete' } = {}) {
    if (collide) colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
    if (solid) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.PM.dark); b.position.set(cx, cy, cz); b.visible = false; b.userData.surface = surface; this.scene.add(b); solids.push(b); }
  }

  /**
   * 무너진 벽 하나. axis 'x' = x 방향 벽(z 고정). openings [{ c, w, y0, y1 }]: 문·창·포탄 구멍(y1 이 꼭대기 위면 윗부분이 날아간 것)
   * tops: 기둥마다 남은 높이(바닥 기준). 겉면은 회칠 석재, 안쪽 면은 깨진 회벽.
   */
  _wallStrips(axis, a, b, fixed, y, full, tops, openings, outMat, inMat, inward) {
    const L = b - a, n = tops.length, cw = L / n, cols = [];
    for (let i = 0; i < n; i++) {
      const c = a + (i + .5) * cw, top = tops[i], gaps = openings.filter((o) => Math.abs(c - o.c) < o.w / 2).map((o) => [o.y0, Math.min(o.y1, top)]).filter(([y0, y1]) => y1 > y0).sort((p, q) => p[0] - q[0]);
      const pieces = []; let y0 = 0; for (const [g0, g1] of gaps) { if (g0 > y0) pieces.push([y0, g0]); y0 = Math.max(y0, g1); } if (top > y0) pieces.push([y0, top]);
      for (const [p0, p1] of pieces) {   // 바깥 반(회칠)과 안쪽 반(깨진 회벽)
        const h = p1 - p0, ym = y + (p0 + p1) / 2;
        if (axis === 'x') { this._box(outMat, cw + .01, h, WT / 2, c, ym, fixed - inward * WT / 4); this._box(inMat, cw + .01, h, WT / 2, c, ym, fixed + inward * WT / 4); }
        else { this._box(outMat, WT / 2, h, cw + .01, fixed - inward * WT / 4, ym, c); this._box(inMat, WT / 2, h, cw + .01, fixed + inward * WT / 4, ym, c); }
      }
      cols.push({ c, pieces: pieces.map(([p0, p1]) => [Math.round(p0 * 5) / 5, Math.round(p1 * 5) / 5]) });
    }
    // 판정: 같은 모양의 기둥을 이어서 큰 상자로
    let i = 0;
    while (i < n) {
      let j = i; const key = JSON.stringify(cols[i].pieces); while (j + 1 < n && JSON.stringify(cols[j + 1].pieces) === key) j++;
      const s0 = a + i * cw, s1 = a + (j + 1) * cw, m = (s0 + s1) / 2, len = s1 - s0;
      for (const [p0, p1] of cols[i].pieces) {
        const cy = y + (p0 + p1) / 2, h = p1 - p0, walkBlock = p0 < 1.2;   // 바닥에서 1.2m 위로 뜬 조각은 이동을 막지 않음(창 아래 벽 등은 막음)
        if (axis === 'x') this._hit(m, cy, fixed, len, h, WT, { collide: walkBlock }); else this._hit(fixed, cy, m, WT, h, len, { collide: walkBlock });
      }
      // 창 아래 벽(바닥부터 시작)이면 위쪽까지 이동 판정을 높여 넘어가지 못하게
      i = j + 1;
    }
  }
  /** 남은 높이 윤곽: 피해가 클수록 들쭉날쭉하고 낮다(한 구간은 크게 무너짐) */
  _tops(n, full, dmg) {
    const tops = []; let t = full, drop = rnd() < dmg ? Math.floor(rnd() * n) : -99, dropW = 2 + Math.floor(rnd() * n * .5);
    for (let i = 0; i < n; i++) {
      t = clamp(t + rr(-1, 1) * dmg * 1.6, full * (1 - dmg * .75), full);
      let v = t; if (i >= drop && i < drop + dropW) v = Math.min(v, rr(.6, 1.8) + (1 - dmg) * 1.5);
      tops.push(dmg < .15 ? full : v);
    }
    return tops;
  }
  _ruin(H) {
    const P = this.P3, y = heightAt(H.x, H.z) - .05, full = H.floors * FH + .3, x0 = H.x - H.w / 2, x1 = H.x + H.w / 2, z0 = H.z - H.d / 2, z1 = H.z + H.d / 2;
    const win = (c, fl, w = 1.0) => ({ c, w, y0: fl * FH + .9, y1: fl * FH + 2.15 }), door = (c) => ({ c, w: 1.4, y0: 0, y1: 2.3 });
    // z1(+z) = 남쪽 면, z0 = 북쪽 면, x0 = 서쪽, x1 = 동쪽
    const walls = [['x', x0, x1, z1, 's'], ['x', x0, x1, z0, 'n'], ['z', z0, z1, x0, 'w'], ['z', z0, z1, x1, 'e']];
    for (const [axis, a, b, fixed, side] of walls) {
      const L = b - a, n = Math.max(4, Math.round(L / .75)), ops = [], faceMatch = H.face === side;
      if (faceMatch) ops.push(door((a + b) / 2));
      for (let fl = 0; fl < H.floors; fl++) for (let c = a + 1.6; c < b - 1.2; c += 2.6) if (!(faceMatch && fl === 0 && Math.abs(c - (a + b) / 2) < 1.6)) ops.push(win(c, fl));
      if (rnd() < H.dmg * .8) { const c = rr(a + 1.5, b - 1.5), w = rr(1.4, 3.2), y0 = rr(0, 1.6) * (rnd() < .5 ? 1 : 0); ops.push({ c, w, y0, y1: full + 1 }); }   // 포탄 구멍
      this._wallStrips(axis, a, b, fixed, y, full, this._tops(n, full, H.dmg), ops, P.wall, P.inner, axis === 'x' ? (fixed === z1 ? -1 : 1) : (fixed === x0 ? 1 : -1));
    }
    // 2층 바닥: 피해가 크면 절반쯤 내려앉음(기울어진 판)
    if (H.floors > 1) {
      const keep = H.dmg > .5 ? .5 : 1, w = (H.w - WT) * keep;
      this._box(P.floor, w, .22, H.d - WT, x0 + WT / 2 + w / 2, y + FH, H.z);
      this._hit(x0 + WT / 2 + w / 2, y + FH, H.z, w, .25, H.d - WT, { collide: false, surface: 'wood' });
      if (keep < 1) { const g = new THREE.BoxGeometry(H.w * .45, .2, H.d - WT); g.rotateZ(-.55); g.translate(x1 - H.w * .26, y + FH * .5, H.z); PB.boxUV(g, 1.6); (this.geo.get(P.floor) || this.geo.set(P.floor, []).get(P.floor)).push(g); }
    }
    // 지붕: 덜 부서졌으면 슬레이트 지붕 일부, 아니면 그을린 서까래 몇 개
    if (H.dmg < .35) this._roof(H.x, H.z, H.w, H.d, y + full, 2.4);
    else for (let k = 0; k < 4 - Math.round(H.dmg * 3); k++) { const g = new THREE.BoxGeometry(.18, .18, H.d * .62); g.rotateX(rr(.45, .7)); g.translate(x0 + 1 + k * (H.w - 2) / 3, y + full + .8, H.z - H.d * .18); PB.boxUV(g, 1.6); (this.geo.get(P.beam) || this.geo.set(P.beam, []).get(P.beam)).push(g); }
    // 잔해 더미(밖·안)
    const piles = 1 + Math.round(H.dmg * 3);
    for (let k = 0; k < piles; k++) { const out = k % 2 === 0, side = rnd() < .5 ? -1 : 1, px = out ? H.x + side * (H.w / 2 + rr(.6, 1.8)) : H.x + rr(-H.w / 4, H.w / 4), pz = out ? H.z + rr(-H.d / 3, H.d / 3) : H.z + rr(-H.d / 4, H.d / 4);
      if (Math.abs(px - ROAD_X) < 4.2) continue;
      const m = new THREE.Mesh(PB.mound(rr(1.4, 2.4), rr(.6, 1.3) * (.5 + H.dmg), rr(1.2, 2), k + H.x), P.rubble); m.position.set(px, heightAt(px, pz) - .1, pz); m.rotation.y = rnd() * 6; this.scene.add(m);
      this._chunks(px, pz, 14); }
  }
  _roof(cx, cz, w, d, y, rise) {
    const over = .4, half = d / 2 + over, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const sgn of [-1, 1]) { const g = new THREE.BoxGeometry(w + over * 2, .18, slope); g.rotateX(sgn * ang); g.translate(cx, y + rise / 2, cz + sgn * half / 2); PB.boxUV(g, 1.6); (this.geo.get(this.P3.slate) || this.geo.set(this.P3.slate, []).get(this.P3.slate)).push(g); }
    for (const sx of [-1, 1]) { const tri = new THREE.Shape(); tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, rise); tri.closePath(); const g = new THREE.ExtrudeGeometry(tri, { depth: WT, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(cx + sx * w / 2 - WT / 2, y, cz); PB.boxUV(g, 1.6); (this.geo.get(this.P3.wall) || this.geo.set(this.P3.wall, []).get(this.P3.wall)).push(g); }
  }
  /** 흩어진 돌·벽돌 조각(인스턴싱) */
  _chunks(cx, cz, n) {
    const list = this._chunkList || (this._chunkList = []);
    for (let i = 0; i < n; i++) { const x = cx + rr(-2.6, 2.6), z = cz + rr(-2.6, 2.6), s = rr(.12, .38); list.push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + s * .3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), new V3(s * rr(1, 1.8), s * rr(.5, .9), s * rr(.8, 1.4)))); }
  }

  // ------------------------------------------------------------- 성당·면사무소
  _church() {
    const C = CHURCH, P = this.P3, y = heightAt(C.x, C.z) - .05, h = 7.5, x0 = C.x - C.w / 2, x1 = C.x + C.w / 2, z0 = C.z - C.d / 2, z1 = C.z + C.d / 2;
    const arch = (c, fl = 0) => ({ c, w: 1.2, y0: 2.2 + fl, y1: 5.4 + fl });
    this._wallStrips('z', z0, z1, x0, y, h, this._tops(26, h, .55), [arch(C.z - 5), arch(C.z), arch(C.z + 5)], P.stone, P.inner, 1);
    this._wallStrips('z', z0, z1, x1, y, h, this._tops(26, h, .75), [arch(C.z - 5), arch(C.z + 5), { c: C.z, w: 4, y0: .5, y1: h + 2 }], P.stone, P.inner, -1);
    this._wallStrips('x', x0, x1, z1, y, h, this._tops(14, h, .3), [{ c: C.x, w: 2.2, y0: 0, y1: 3.6 }, { c: C.x, w: 1.6, y0: 4.6, y1: 6.6 }], P.stone, P.inner, -1);
    this._wallStrips('x', x0, x1, z0, y, h, this._tops(14, h, .4), [arch(C.x)], P.stone, P.inner, 1);
    // 종탑(남쪽 정면 위, 윗부분이 날아감)
    const tx = C.x, tz = z1 + 2.2, th = 15;
    this._wallStrips('x', tx - 2.2, tx + 2.2, tz + 2, y, th, this._tops(6, th, .7), [{ c: tx, w: 1.1, y0: 9, y1: 11.5 }], P.stone, P.inner, -1);
    this._wallStrips('x', tx - 2.2, tx + 2.2, tz - 2, y, th, this._tops(6, th, .6), [], P.stone, P.inner, 1);
    this._wallStrips('z', tz - 2, tz + 2, tx - 2.2, y, th, this._tops(6, th, .65), [{ c: tz, w: 1.1, y0: 9, y1: 11.5 }], P.stone, P.inner, 1);
    this._wallStrips('z', tz - 2, tz + 2, tx + 2.2, y, th, this._tops(6, th, .75), [{ c: tz, w: 1.4, y0: 0, y1: 2.5 }], P.stone, P.inner, -1);
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(PB.mound(rr(2, 3.4), rr(.8, 1.6), rr(2, 3), 40 + k), P.rubble); const px = C.x + rr(-3, 3), pz = C.z + rr(-7, 7); m.position.set(px, y - .05, pz); this.scene.add(m); this._chunks(px, pz, 20); }
  }
  _townHall() {
    const T = CP, P = this.P3, y = heightAt(T.x, T.z) - .05, full = T.floors * FH + .3, x0 = T.x - T.w / 2, x1 = T.x + T.w / 2, z0 = T.z - T.d / 2, z1 = T.z + T.d / 2;
    const win = (c, fl) => ({ c, w: 1.1, y0: fl * FH + .95, y1: fl * FH + 2.25 });
    const wins = (a, b) => { const o = []; for (let fl = 0; fl < 2; fl++) for (let c = a + 1.8; c < b - 1.2; c += 2.6) o.push(win(c, fl)); return o; };
    this._wallStrips('z', z0, z1, x0, y, full, this._tops(13, full, .15), [{ c: T.z, w: 1.6, y0: 0, y1: 2.6 }, ...wins(z0, z1).filter((o) => !(o.y0 < 2 && Math.abs(o.c - T.z) < 1.8))], P.wall, P.inner, 1);
    this._wallStrips('z', z0, z1, x1, y, full, this._tops(13, full, .3), wins(z0, z1), P.wall, P.inner, -1);
    this._wallStrips('x', x0, x1, z1, y, full, this._tops(18, full, .2), [...wins(x0, x1), { c: x1 - 3, w: 2.6, y0: .2, y1: full + 1 }], P.wall, P.inner, -1);
    this._wallStrips('x', x0, x1, z0, y, full, this._tops(18, full, .15), wins(x0, x1), P.wall, P.inner, 1);
    this._wallStrips('z', z0 + WT, z1 - WT, CP_ROOM.maxX, y, FH, this._tops(12, FH, 0), [{ c: T.z + 2, w: 1.1, y0: 0, y1: 2.2 }], P.inner, P.inner, 1);   // 안쪽 칸막이
    this._box(P.floor, T.w - WT, .22, T.d - WT, T.x, y + FH, T.z); this._hit(T.x, y + FH, T.z, T.w - WT, .25, T.d - WT, { collide: false, surface: 'wood' });
    this._box(P.floor, T.w - WT, .08, T.d - WT, T.x, y + .04, T.z);
    this._roof(T.x, T.z, T.w, T.d, y + full, 2.8);
    // 지휘소: 탁자·무전기·작전 지도·상자
    const cx = (CP_ROOM.minX + CP_ROOM.maxX) / 2, cz = (CP_ROOM.minZ + CP_ROOM.maxZ) / 2;
    const table = this.assets.instantiate('props.table', { fit: [1.8, .8, 1.0], fitMode: 'stretch' }); if (table) { table.position.set(cx, y + .08, cz); table.rotation.y = Math.PI / 2; this.scene.add(table); }
    const radio = this.assets.instantiate('props.radio', { fit: [.5, .35, .35] }); if (radio) { radio.position.set(cx, y + .86, cz - .5); radio.rotation.y = -.3; this.scene.add(radio); }
    const map = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshStandardMaterial({ map: this._mapTex(), roughness: 1 })); map.position.set(CP_ROOM.minX + .3, y + 1.8, cz); map.rotation.y = Math.PI / 2; this.scene.add(map);
    for (const [px, pz] of [[CP_ROOM.maxX - .8, z1 - 1.1], [CP_ROOM.maxX - .8, z0 + 1.1]]) { const m = this.assets.instantiate('props.crate', { fit: [.9, .6, .7] }); if (m) { m.position.set(px, y, pz); this.scene.add(m); } }
    this.cpY = y;
  }
  _mapTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 352; const g = c.getContext('2d');
    g.fillStyle = '#d6cba8'; g.fillRect(0, 0, 512, 352); g.strokeStyle = '#555'; g.lineWidth = 3; g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 352); g.moveTo(0, 200); g.lineTo(512, 200); g.stroke();
    g.fillStyle = 'rgba(140,40,30,.8)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(80 + i * 70, 280 - i * 10, 14, 0, 6.28); g.fill(); }
    g.strokeStyle = '#1f3a6a'; g.lineWidth = 4; g.beginPath(); g.moveTo(256, 340); g.lineTo(256, 230); g.lineTo(240, 245); g.moveTo(256, 230); g.lineTo(272, 245); g.stroke();
    g.fillStyle = '#222'; g.font = 'bold 20px serif'; g.fillText('Marigny — St-Gilles', 20, 30); g.font = '15px serif'; g.fillText('Kreuzung halten!', 300, 190);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ------------------------------------------------------------- 차량
  _vehicles() {
    const PM = this.PM, P = this.P3;
    for (const w of WRECKS) {
      const g = w.kind === 'truck' ? this._truck() : w.kind === 'halftrack' ? this._halftrack() : this._panzer();
      g.position.set(w.x, heightAt(w.x, w.z), w.z); g.rotation.y = w.yaw; this.scene.add(g);
      const L = w.kind === 'panzer' ? [3.3, 2.4, 6] : w.kind === 'halftrack' ? [2.3, 2, 5.8] : [2.3, 2.6, 6.2];
      const c = Math.abs(Math.cos(w.yaw)), sn = Math.abs(Math.sin(w.yaw)), sx = L[0] * c + L[2] * sn, sz = L[0] * sn + L[2] * c;
      this._hit(w.x, heightAt(w.x, w.z) + L[1] / 2, w.z, sx * .85, L[1], sz * .85, { surface: 'metal' });
    }
    // 아군 셔먼(집결지) — 움직이는 그룹(목표 3 이후 전진). 판정 상자는 게임 규칙이 함께 옮긴다
    const s = PB.shermanParts(), tank = new THREE.Group();
    for (const [geo, mat] of [[s.hull, PM.tank], [s.track, PM.burnt], [s.wheel, PM.burnt]]) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.userData.keepShadow = true; tank.add(m); }
    const turret = new THREE.Group(); turret.position.set(0, 2.05, .2);
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(.95, 1.1, .75, 14), PM.tank); turret.add(tb); const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.07, .08, 2.6, 10), PM.gun); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .05, 1.9); turret.add(barrel); tank.add(turret);
    tank.position.set(RALLY.x, heightAt(RALLY.x, RALLY.z), RALLY.z); tank.rotation.y = Math.PI; tank.userData.dynamic = true; tank.traverse((o) => { o.userData.dynamic = true; });
    this.scene.add(tank); this.tank = tank; this.tankTurret = turret;
    this.tankCollider = { minX: 0, maxX: 0, minY: -9, maxY: 9, minZ: 0, maxZ: 0 }; colliders.push(this.tankCollider); this.moveTank(RALLY.x, RALLY.z);
  }
  /** 셔먼을 옮기고 이동 판정 상자도 함께 */
  moveTank(x, z, yaw = Math.PI) { const t = this.tank, y = heightAt(x, z); t.position.set(x, y, z); t.rotation.y = yaw; const c = this.tankCollider; c.minX = x - 1.7; c.maxX = x + 1.7; c.minZ = z - 3.1; c.maxZ = z + 3.1; c.minY = y - 1; c.maxY = y + 2.6; }
  _truck() {   // 오펠 블리츠: 앞이 둥근 보닛, 운전석, 짐칸(덮개 뼈대만 남음) — 그을림
    const g = new THREE.Group(), P = this.P3, PM = this.PM, add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m; };
    add(PB.roundedBox(1.7, .9, 1.6, .2), PM.burnt, 0, 1.25, 2.1); add(PB.roundedBox(2.1, 1.3, 1.4, .12), PM.burnt, 0, 1.6, .9);
    add(PB.roundedBox(2.3, .18, 3.6, .04), P.charred, 0, 1.05, -1.4); for (const s of [-1, 1]) add(PB.roundedBox(.08, .55, 3.6, .02), P.charred, s * 1.1, 1.38, -1.4);
    for (let k = 0; k < 4; k++) add(new THREE.TorusGeometry(1.05, .04, 6, 16, Math.PI), PM.burnt, 0, 1.15, -2.8 + k * .95, 0, 0).rotation.y = Math.PI / 2;
    for (const [x, z] of [[-1, 2.1], [1, 2.1], [-1, -1.9], [1, -1.9]]) add(new THREE.CylinderGeometry(.48, .48, .3, 14), P.charred, x, .48, z, 0, Math.PI / 2);
    return g;
  }
  _halftrack() {   // Sd.Kfz. 251: 경사진 장갑 차체, 앞바퀴, 뒤 궤도
    const g = new THREE.Group(), PM = this.PM, P = this.P3;
    const side = new THREE.Shape(); side.moveTo(-2.9, .55); side.lineTo(1.6, .55); side.lineTo(2.9, 1.05); side.lineTo(2.6, 1.55); side.lineTo(.9, 1.85); side.lineTo(-2.9, 1.85); side.closePath();
    const hull = new THREE.ExtrudeGeometry(side, { depth: 2.1, bevelEnabled: false }); hull.translate(0, 0, -1.05); hull.rotateY(-Math.PI / 2); PB.boxUV(hull, 1.5); g.add(new THREE.Mesh(hull, P.greyTank));
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(PB.roundedBox(.35, .65, 3.4, .1), PM.burnt); tr.position.set(s * .95, .42, -1.1); g.add(tr); const wh = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .22, 12), P.charred); wh.rotation.z = Math.PI / 2; wh.position.set(s * .95, .42, 2.1); g.add(wh); }
    return g;
  }
  _panzer() {   // 4호 전차(파괴됨): 차체·포탑·장포신·궤도·측면 장갑판
    const g = new THREE.Group(), P = this.P3, PM = this.PM;
    const hull = new THREE.Mesh(PB.roundedBox(2.9, 1.1, 5.8, .06), P.greyTank); hull.position.y = 1.15; g.add(hull);
    const tur = new THREE.Mesh(PB.roundedBox(1.9, .8, 2.3, .08), P.greyTank); tur.position.set(.2, 2.1, .3); tur.rotation.y = .5; g.add(tur);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, 3.4, 8), PM.gun); gun.rotation.set(Math.PI / 2 - .12, 0, 0); gun.position.set(1.1, 2.2, 2); gun.rotation.y = .5; g.add(gun);
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(PB.roundedBox(.5, .9, 6.0, .15), PM.burnt); tr.position.set(s * 1.45, .55, 0); g.add(tr); const sk = new THREE.Mesh(PB.roundedBox(.05, .6, 4.6, .01), P.greyTank); sk.position.set(s * 1.75, 1.25, -.2); sk.rotation.z = s * .08; g.add(sk); }
    return g;
  }

  // ------------------------------------------------------------- 진지
  _guns() {
    const PM = this.PM;
    // Pak 40 대전차포: 방패(두 장, 경사), 긴 포신 + 포구 제퇴기, 벌린 포가 다리, 바퀴
    this.atGuns = AT_GUNS.map((A) => { const g = this._pak40(); g.position.set(A.x, heightAt(A.x, A.z), A.z); g.rotation.y = A.yaw; g.userData.dynamic = true; g.traverse((o) => { o.userData.dynamic = true; }); this.scene.add(g); this._hit(A.x, heightAt(A.x, A.z) + .6, A.z, 2.2, 1.2, 1.4, { surface: 'metal', collide: true }); return g; });
    // 모래주머니(진지 둘레)
    const bagGeo = this._modelGeometry('props.sandbag', (g) => { g.rotateY(Math.PI / 2); const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new V3()), c = b.getCenter(new V3()); g.translate(-c.x, -c.y, -c.z); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z); }) || new THREE.SphereGeometry(.5, 10, 7);
    const bags = [], ring = (cx, cz, r, a0, a1, rows) => { for (let k = 0; k < rows; k++) for (let a = a0; a <= a1; a += .62 / r) { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; bags.push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + .13 + k * .26, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0)), new V3(.74, .34, .62))); } };
    for (const A of AT_GUNS) ring(A.x, A.z, 2.4, .35, Math.PI - .35, 3);
    const N = MG_NESTS[0]; ring(N.x, N.z, 1.5, .25, Math.PI - .25, 3); this._hit(N.x, heightAt(N.x, N.z + 1.3) + .45, N.z + 1.3, 3, .9, .4, { collide: true, surface: 'sand' });
    const mg = PB.mg42Geometry(); for (const [geo, mat] of [[mg.steel, PM.gun], [mg.wood, PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(N.x, heightAt(N.x, N.z) + .95, N.z + .6); this.scene.add(m); }
    const W = MG_NESTS[1]; for (const [geo, mat] of [[mg.steel, PM.gun], [mg.wood, PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(W.x - 3.4, heightAt(W.x, W.z) + W.y + .95, W.z); m.rotation.y = -Math.PI / 2 + Math.PI; this.scene.add(m); }
    const im = new THREE.InstancedMesh(bagGeo, this.M.bag, bags.length); bags.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; im.userData.keepShadow = true; this.scene.add(im);
  }
  _pak40() {
    const g = new THREE.Group(), P = this.P3, PM = this.PM, steel = P.greyTank;
    for (const s of [-1, 1]) { const sh = new THREE.Mesh(PB.roundedBox(.9, 1.0, .05, .01), steel); sh.position.set(s * .48, .95, .25); sh.rotation.set(-.2, s * -.22, 0); g.add(sh); }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, 3.1, 10), PM.gun); barrel.rotation.x = Math.PI / 2 - .04; barrel.position.set(0, 1.0, 1.55); g.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .28, 10), PM.gun); brake.rotation.x = Math.PI / 2; brake.position.set(0, 1.06, 3.05); g.add(brake);
    const breech = new THREE.Mesh(PB.roundedBox(.35, .35, .7, .04), steel); breech.position.set(0, 1.0, -.15); g.add(breech);
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(PB.roundedBox(.12, .12, 2.4, .02), steel); tr.position.set(s * .55, .25, -1.25); tr.rotation.y = s * .32; g.add(tr); const wh = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .16, 14), PM.burnt); wh.rotation.z = Math.PI / 2; wh.position.set(s * .82, .42, .15); g.add(wh); }
    g.userData.barrel = barrel; g.userData.brake = brake; return g;
  }
  /** 대전차포 파괴: 포신이 꺾이고 그을림 */
  breakGun(i) { const g = this.atGuns[i]; if (!g || g.userData.broken) return; g.userData.broken = true; g.userData.barrel.rotation.x = Math.PI / 2 + .35; g.userData.brake.position.y = .4; g.rotation.z = .18; g.traverse((o) => { if (o.isMesh) o.material = this.P3.charred; }); g.updateMatrixWorld(true); }

  // ------------------------------------------------------------- 폭격 지대·거리
  _bombZone() {
    const P = this.P3, stumps = [];
    for (let i = 0; i < 40; i++) { const x = rr(-68, 68), z = rr(28, 100); if (Math.abs(x) < 5) continue; const h = rr(.6, 4.5), r = rr(.15, .32);
      stumps.push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + h / 2 - .1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-.35, .35), rnd() * 6, rr(-.35, .35))), new V3(r, h, r))); }
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(.8, 1, 1, 7), P.charred, stumps.length); stumps.forEach((m, i) => im.setMatrixAt(i, m)); this.scene.add(im);
    // 흩어진 잔해 조각
    for (let i = 0; i < 30; i++) this._chunks(rr(-64, 64), rr(30, 98), 6);
    const chunks = this._chunkList || [];
    this.lods.push(new InstanceLOD(this.scene, [{ geometry: new THREE.IcosahedronGeometry(.7, 0), material: P.rubble }], chunks, { near: 40, far: 120 }));
    // 부서진 철조망
    for (const [a, b, z] of [[-60, -30, 34], [-20, 6, 36], [16, 52, 33]]) { const w = PB.barbedWire(new V3(a, 0, z), new V3(b, 0, z + rr(-2, 2)), heightAt); const m1 = new THREE.Mesh(w.wire, this.PM.wire), m2 = new THREE.Mesh(w.posts, this.PM.wood); m1.userData.noShadow = true; this.scene.add(m1, m2); }
  }
  _streetProps() {
    const P = this.P3;
    // 전신주(일부 기울어짐)와 늘어진 전선
    const poles = [];
    for (let z = 96; z > -90; z -= 22) { const x = 5.2, lean = rnd() < .35 ? rr(.15, .5) : 0; poles.push([x, z, lean]); this._box(P.beam, .22, 7, .22, x, heightAt(x, z) + 3.4, z); }
    this._flushGeo();
    // 길가 모래주머니·상자·통
    for (const [x, z] of [[-6, -14], [7, -26], [-8, -44], [30, -16]]) { const m = this.assets.instantiate('decor.crate'); if (m) { m.position.set(x, heightAt(x, z), z); m.rotation.y = rnd() * 6; this.scene.add(m); } }
    for (const [x, z] of [[-5, 30], [8, -50], [26, -24]]) { const m = this.assets.instantiate('decor.barrel'); if (m) { m.position.set(x, heightAt(x, z), z); this.scene.add(m); } }
  }
  _groundCover3() {
    const a = new THREE.PlaneGeometry(1, 1); a.translate(0, .5, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const geo = mergeGeometries([a, b]);
    const N = 7000, im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.tex.grass, alphaTest: .45, side: THREE.DoubleSide }), N), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    let k = 0;
    for (let i = 0; i < N * 4 && k < N; i++) {
      const x = rr(-74, 74), z = rr(-94, 104); if (Math.abs(x) < 4.5 || (z < 22 && Math.abs(z - CROSS_Z) < 4.5)) continue;
      if (HOUSES.some((H) => Math.abs(x - H.x) < H.w / 2 + 1 && Math.abs(z - H.z) < H.d / 2 + 1)) continue;
      if (CRATERS3.some((C) => Math.hypot(x - C.x, z - C.z) < C.r * 1.2)) continue;
      const w = rr(.3, .7), h = rr(.18, .45); e.set(0, rr(0, 3.14), 0); q.setFromEuler(e); m.compose(new V3(x, heightAt(x, z) - .03, z), q, new V3(w, h, w)); im.setMatrixAt(k, m);
      const v = rr(.6, 1.1); c.setRGB(.17 * v, .19 * v, .08 * v); im.setColorAt(k, c); k++;
    }
    im.count = k; im.userData.noShadow = true; this.scene.add(im);
  }
}
