// Stage 4 전장 그래픽 — 1944년 8월의 파리: 오스만식 석조 건물(1층 상점, 창틀, 연철 발코니, 처마 돌림띠, 망사르 지붕),
// 돌로 포장된 큰길과 인도, 플라타너스·가로등·모리스 기둥, 카페, 독일군 검문소, 레지스탕스 바리케이드, 1940년대 승용차,
// 안으로 들어가는 점령 건물, 광장과 구청(기둥 현관·깃대).
// 건물 장식은 재질별로 합쳐 Draw Call 을 줄인다. 판정은 건물 덩어리마다 보이지 않는 상자.
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/jsm/utils/BufferGeometryUtils.js';
import { EnvironmentManager } from '../../graphics/EnvironmentManager.js';
import { createTerrainMaterial } from '../../graphics/TerrainMaterial.js';
import { InstanceLOD, partsOf } from '../../graphics/InstanceLOD.js';
import * as PB from '../../graphics/PropBuilder.js';
import { heightAt, solids, colliders } from '../../game/world.js';
import { V3, clamp } from '../../core/utils.js';
import { BLOCKS, OCCUPIED, CAFE, CHECKPOINT, SAFE, SQUARE, HALL, ROAD, STREET_H } from './layout.js';

const LAYERS = [
  { name: 'cobblestone_01', tile: 2.0, rough: .8 },     // 0 차도 돌길
  { name: 'stone_tiles_02', tile: 2.4, rough: .85 },    // 1 인도
  { name: 'brick_gravel', tile: 2.4, rough: .9 },       // 2 잔해
  { name: 'burned_ground_01', tile: 3.0, rough: .95 },  // 3 그을음
  { name: 'leafy_grass', tile: 2.6, rough: .95 },       // 4 가로수 둘레 흙·풀
  { name: 'cobblestone_01', tile: 1.4, rough: .8 },     // 5 광장(더 촘촘한 돌)
];
const G1 = 4.5, FL = 3.2, NF = 4, TOP = G1 + FL * NF;   // 1층 높이, 위층 높이·수, 처마 높이(17.3m)
let seed = 8251944; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const rr = (a, b) => a + rnd() * (b - a);
const SIGNS = ['CAFÉ', 'BOULANGERIE', 'PHARMACIE', 'TABAC', 'LIBRAIRIE', 'BOUCHERIE', 'HÔTEL', 'ÉPICERIE', 'COIFFEUR', 'VINS'];

export class ParisEnvironment extends EnvironmentManager {
  constructor(deps) { super(deps); this.stageId = 4; this.smokeSources = [[30, -60], [-6, 44]]; this.fireSources = [[30, -60]]; }

  build() {
    this.lods = []; this.gfxSwap = []; this.geo = new Map();
    this.PM = this._materials(); this._parisMaterials();
    this._terrain4();
    this._skyAndWater(); this.water.visible = false;
    for (const B of BLOCKS) this._block(B);
    this._occupied(); this._hall();
    this._flush();
    this._checkpoint(); this._barricade(); this._cafe(); this._square(); this._cars(); this._street();
    this._flush();
    const lodMeshes = new Set(); for (const l of this.lods) for (const L of l.levels) for (const im of [L.near, L.mid, L.far]) if (im) lodMeshes.add(im);
    this.scene.traverse((o) => { if (o.isMesh && !lodMeshes.has(o) && !o.userData.keepShadow && o !== this.terrain && o !== this.water && o !== this.sky) { o.castShadow = o.visible && !o.userData.noShadow; o.receiveShadow = true; } });
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => { if (o !== this.scene && o !== this.sky && o !== this.water && !o.isLight && o !== this.lighting.sun.target && !o.userData.dynamic) o.matrixAutoUpdate = false; });
    for (const l of this.lods) l.update(new V3(0, 2, 100), true);
  }

  // ------------------------------------------------------------- 재질·텍스처
  _parisMaterials() {
    const a = this.assets, S = (o) => new THREE.MeshStandardMaterial(o), beige = a.pbr('beige_wall_001', 1, 1);
    const ashlar = this._ashlarTexture();
    this.P4 = {
      stone: S({ map: ashlar, normalMap: beige.normalMap, roughness: .92, color: 0xffffff }),
      trim: S({ color: 0xe9e0cc, ...a.pbr('beige_wall_001', .5, .5) }),
      zinc: S({ color: new THREE.Color(0x8f9aa4).multiplyScalar(1.25), metalness: .35, ...a.pbr('grey_roof_tiles', .6, .6) }),
      glass: S({ color: 0x161a1e, roughness: .12, metalness: .6 }),
      iron: S({ map: this._railingTexture(), alphaTest: .45, side: THREE.DoubleSide, color: 0x222426, metalness: .5, roughness: .5 }),
      shopG: S({ color: 0x2f4a3a, roughness: .6 }), shopR: S({ color: 0x6a2a24, roughness: .6 }), shopB: S({ color: 0x2a3550, roughness: .6 }),
      shutter: S({ color: new THREE.Color(0x7c8288).multiplyScalar(1.3), metalness: .5, ...a.pbr('metal_plate', .6, .6) }),
      door: S({ color: 0x4a3426, ...a.pbr('weathered_planks', .6, .6) }),
      wallpaper: S({ color: new THREE.Color(0xd8cdb8).multiplyScalar(1.4), ...a.pbr('decrepit_wallpaper', .5, .5) }),
      floor: S({ color: 0xb49a7c, ...a.pbr('wood_floor_worn', .45, .45) }),
      paving: S({ color: 0xd8d0c0, ...a.pbr('cobblestone_01', .8, .8) }),
      car: S({ color: 0x14161a, metalness: .55, roughness: .35 }), carBurnt: S({ color: 0x3a302a, metalness: .4, ...a.pbr('rusty_metal_02', .6, .6) }),
      tyre: S({ color: 0x18181a, roughness: .9 }), chrome: S({ color: 0xcfd3d6, metalness: .9, roughness: .25 }),
      bark: S({ color: 0xb8aa98, ...a.pbr('bark_brown_02', .6, 1.6) }), leaf: S({ map: this._leafTexture(), roughness: .9 }),
      morris: S({ color: 0x2c4a36, roughness: .6, metalness: .3 }), poster: S({ map: this._posterTexture(), roughness: 1 }),
      flag: S({ map: this._flagTexture(), side: THREE.DoubleSide, roughness: 1 }),
      awning: S({ map: this._stripeTexture(), side: THREE.DoubleSide, roughness: 1 }),
      sign: S({ map: this._signTexture(), roughness: .7 }),
      redWhite: S({ map: this._barrierTexture(), roughness: .7 }),
    };
  }
  _canvas(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
  /** 오스만식 석회암 마름돌: 4m × 4m 한 장에 0.4m 높이 돌 줄, 엇갈린 이음매, 돌마다 미세한 색 차 */
  _ashlarTexture() {
    return this._canvas(1024, 1024, (g, W, H) => {
      g.fillStyle = '#cfc2a6'; g.fillRect(0, 0, W, H); const row = H / 10;
      for (let r = 0; r < 10; r++) { const y = r * row; let x = -(r % 2) * 80; while (x < W) { const w = 150 + rnd() * 70; const v = 190 + rnd() * 26 | 0; g.fillStyle = `rgb(${v + 8},${v - 2},${v - 26})`; g.fillRect(x + 2, y + 2, w - 4, row - 4);
        for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${90 + rnd() * 60},${80 + rnd() * 50},${60 + rnd() * 40},${rnd() * .08})`; g.fillRect(x + rnd() * w, y + rnd() * row, 2 + rnd() * 6, 2 + rnd() * 6); }
        g.fillStyle = 'rgba(70,60,45,.25)'; g.fillRect(x + 2, y + row - 5, w - 4, 3); x += w; } }
      g.fillStyle = 'rgba(60,52,40,.12)'; for (let i = 0; i < 30; i++) g.fillRect(rnd() * W, 0, 2 + rnd() * 3, H);   // 빗물 자국
    });
  }
  _railingTexture() { return this._canvas(512, 128, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 8, W, 8);
    for (let x = 6; x < W; x += 16) g.fillRect(x, 10, 3, H - 18); g.strokeStyle = '#fff'; g.lineWidth = 3; for (let x = 0; x < W; x += 64) { g.beginPath(); g.arc(x + 32, 50, 18, 0, 6.28); g.stroke(); g.beginPath(); g.moveTo(x + 14, 90); g.quadraticCurveTo(x + 32, 70, x + 50, 90); g.stroke(); } }); }
  _leafTexture() { return this._canvas(256, 256, (g, W) => { g.fillStyle = '#26331a'; g.fillRect(0, 0, W, W); for (let i = 0; i < 1400; i++) { g.save(); g.translate(rnd() * W, rnd() * W); g.rotate(rnd() * 6.28); g.fillStyle = `hsl(${78 + rnd() * 30},${35 + rnd() * 25}%,${16 + rnd() * 26}%)`; g.beginPath(); g.ellipse(0, 0, 5 + rnd() * 6, 3 + rnd() * 3, 0, 0, 6.28); g.fill(); g.restore(); } }); }
  _posterTexture() { return this._canvas(512, 256, (g, W, H) => { g.fillStyle = '#d8ccb0'; g.fillRect(0, 0, W, H); const cols = ['#a23b2c', '#2b3f6b', '#d8a842', '#3a5a3a']; for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 4]; g.fillRect(i * 85 + 4, 10 + (i % 2) * 20, 78, 200); g.fillStyle = '#f0e8d0'; g.font = 'bold 16px serif'; g.fillText(['THÉÂTRE', 'CINÉMA', 'CONCERT', 'OPÉRA', 'CIRQUE', 'BAL'][i], i * 85 + 10, 60 + (i % 2) * 20); } }); }
  _flagTexture() { return this._canvas(192, 128, (g) => { g.fillStyle = '#1f3a8a'; g.fillRect(0, 0, 64, 128); g.fillStyle = '#f2f2ee'; g.fillRect(64, 0, 64, 128); g.fillStyle = '#c8282e'; g.fillRect(128, 0, 64, 128); }); }   // 프랑스 삼색기
  _stripeTexture() { return this._canvas(256, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e8e0cc' : '#7a2a26'; g.fillRect(i * 32, 0, 32, 64); } }); }
  _barrierTexture() { return this._canvas(256, 32, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f0f0ea' : '#b8262a'; g.fillRect(i * 32, 0, 32, 32); } }); }
  /** 상점 간판(10개를 세로로 한 장에) */
  _signTexture() { return this._canvas(512, 640, (g, W) => { SIGNS.forEach((t, i) => { g.fillStyle = ['#1f3528', '#5c2018', '#1c2a46', '#2a2a2a'][i % 4]; g.fillRect(0, i * 64, W, 64); g.fillStyle = '#e8d8a8'; g.font = 'bold 40px serif'; g.textAlign = 'center'; g.fillText(t, W / 2, i * 64 + 47); }); }); }

  // ------------------------------------------------------------- 지형
  _terrain4() {
    const g = new THREE.PlaneGeometry(128, 224, 128, 224); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sa = new Float32Array(n * 4), sb = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
      const ax = Math.abs(x), inSq = z < SQUARE.z1 && z > SQUARE.z0;
      let walk = 0, deb = 0, burn = 0, pit = 0, sq = 0;
      if (!inSq && ax > ROAD.half && ax < ROAD.walk + 1) walk = 1;
      if (!inSq && ax > ROAD.walk + 1) walk = .9;                    // 골목 바닥
      if (inSq) { sq = .9; if (Math.abs(x) > 40 || z < -90) walk = .8; }
      if (Math.hypot(x + 12, z - 10) < 5 || Math.hypot(x, z - 38) < 6) deb = .6;
      for (const [sx, sz] of this.smokeSources) { const d = Math.hypot(x - sx, z - sz); if (d < 6) burn = Math.max(burn, (1 - d / 6) * .9); }
      for (let tz = 96; tz > -40; tz -= 14) for (const tx of [-8.6, 8.6]) if (Math.hypot(x - tx, z - tz) < .9) pit = 1;
      let s = walk + deb + burn + pit + sq; if (s > 1) { walk /= s; deb /= s; burn /= s; pit /= s; sq /= s; }
      sa[i * 4] = walk; sa[i * 4 + 1] = deb; sa[i * 4 + 2] = burn; sa[i * 4 + 3] = pit; sb[i * 2] = sq;
      const j = .92 + Math.random() * .08; col[i * 3] = j; col[i * 3 + 1] = j * .99; col[i * 3 + 2] = j * .96;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2)); g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, createTerrainMaterial(this.assets, LAYERS)); this.terrain.receiveShadow = true; this.scene.add(this.terrain); this.grassLayer = null;
    // 연석(인도 가장자리 돌)
    for (const sx of [-1, 1]) this._b(this.P4.trim, .3, .2, SQUARE.z1 < 0 ? 108 - SQUARE.z1 : 150, sx * ROAD.half, STREET_H + .07, (108 + SQUARE.z1) / 2);
  }

  // ------------------------------------------------------------- 지오메트리 모으기
  _b(mat, w, h, d, x, y, z, ry = 0, tile = 1.6) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); PB.boxUV(g, tile); this._push(mat, g); }
  _push(mat, g) { (this.geo.get(mat) || this.geo.set(mat, []).get(mat)).push(g.index ? g.toNonIndexed() : g); }
  _flush() { for (const [mat, list] of this.geo) { if (!list.length) continue; for (const g of list) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); const m = new THREE.Mesh(mergeGeometries(list, false), mat); this.scene.add(m); } this.geo.clear(); }
  _hit(cx, cy, cz, sx, sy, sz, { collide = true, solid = true, surface = 'concrete' } = {}) {
    if (collide) colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
    if (solid) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.PM.dark); b.position.set(cx, cy, cz); b.visible = false; b.userData.surface = surface; this.scene.add(b); solids.push(b); }
  }

  // ------------------------------------------------------------- 오스만식 건물
  /** 건물 덩어리 + 거리 쪽 면의 장식 */
  _block(B, { skipGround = false } = {}) {
    const y = STREET_H, w = B.x1 - B.x0, d = B.z1 - B.z0, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    this._b(this.P4.stone, w, TOP, d, cx, y + TOP / 2, cz, 0, 4);
    this._hit(cx, y + 10, cz, w, 22, d);
    this._mansard(B.x0, B.x1, B.z0, B.z1, y + TOP);
    for (const side of B.streets) this._facade(B, side, skipGround);
  }
  /** 면 좌표계: 면을 따라가는 축과 바깥 방향 */
  _faceFrame(B, side) {
    if (side === 'e') return { a: B.z0, b: B.z1, at: (s, o) => [B.x1 + o, s], ry: Math.PI / 2 };
    if (side === 'w') return { a: B.z0, b: B.z1, at: (s, o) => [B.x0 - o, s], ry: Math.PI / 2 };
    if (side === 'n') return { a: B.x0, b: B.x1, at: (s, o) => [s, B.z0 - o], ry: 0 };
    return { a: B.x0, b: B.x1, at: (s, o) => [s, B.z1 + o], ry: 0 };
  }
  _facade(B, side, skipGround) {
    const P = this.P4, F = this._faceFrame(B, side), y = STREET_H, L = F.b - F.a, n = Math.max(2, Math.round(L / 3.3)), bay = L / n, along = F.ry ? 'z' : 'x';
    const box = (mat, s, o, yy, wAlong, h, depth) => { const [x, z] = F.at(s, o); along === 'z' ? this._b(mat, depth, h, wAlong, x, yy, z) : this._b(mat, wAlong, h, depth, x, yy, z); };
    // 돌림띠(층 경계)와 큰 처마
    box(P.trim, (F.a + F.b) / 2, .18, y + G1, L, .45, .36); box(P.trim, (F.a + F.b) / 2, .12, y + G1 + FL, L, .22, .24);
    box(P.trim, (F.a + F.b) / 2, .32, y + TOP - .2, L + .3, .5, .64);
    // 발코니(2층·5층): 돌 선반 + 연철 난간(투명 무늬)
    for (const fl of [1, 4]) { const yy = y + G1 + FL * (fl - 1); box(P.trim, (F.a + F.b) / 2, .45, yy + .05, L - .4, .18, .9); const [x, z] = F.at((F.a + F.b) / 2, .88); const rail = new THREE.PlaneGeometry(L - .5, 1.0); if (along === 'z') rail.rotateY(Math.PI / 2); rail.translate(x, yy + .65, z); const uv = rail.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (L - .5) / 3.2); this._push(P.iron, rail); }
    for (let i = 0; i < n; i++) {
      const s = F.a + (i + .5) * bay;
      // 1층: 상점(유리·간판·차양) 또는 셔터 또는 큰 대문
      if (!skipGround) {
        const kind = rnd(), shopMat = [P.shopG, P.shopR, P.shopB][i % 3];
        if (kind < .55) {
          box(P.glass, s, .06, y + 1.75, bay - .9, 2.6, .1); box(shopMat, s, .14, y + .25, bay - .7, .5, .2);
          for (const e of [-1, 1]) box(shopMat, s + e * (bay - .8) / 2, .14, y + 1.75, .16, 3.0, .2);
          // 간판(문자 텍스처의 한 줄)
          const [x, z] = F.at(s, .2), sg = new THREE.PlaneGeometry(bay - .6, .55), k = (rnd() * SIGNS.length) | 0, uv = sg.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setY(j, 1 - (k + 1 - uv.getY(j)) / SIGNS.length); if (along === 'z') sg.rotateY(F === null ? 0 : (side === 'e' ? Math.PI / 2 : -Math.PI / 2)); else if (side === 'n') sg.rotateY(Math.PI); sg.translate(x, y + 3.55, z); this._push(P.sign, sg);
          if (rnd() < .45) { const [ax, az] = F.at(s, .9), ag = new THREE.PlaneGeometry(bay - .5, 1.6); ag.rotateX(-Math.PI / 2 + .45 * (side === 'w' || side === 's' ? 1 : -1)); if (along === 'z') ag.rotateY(Math.PI / 2); ag.translate(ax, y + 3.05, az); this._push(P.awning, ag); }
        } else if (kind < .85) { box(P.shutter, s, .08, y + 1.6, bay - .8, 3.0, .1); box(P.trim, s, .14, y + 3.3, bay - .5, .4, .2); }
        else { box(P.door, s, .1, y + 1.8, 2.0, 3.6, .14); box(P.trim, s, .2, y + 3.8, 2.6, .5, .3); }
      }
      // 위층 창: 어두운 유리 + 창틀(양옆·창턱·상인방, 2층은 삼각 박공)
      for (let fl = 1; fl <= NF; fl++) {
        const yy = y + G1 + FL * (fl - 1) + .45, wh = fl === NF ? 1.7 : 2.15, ww = 1.15;
        box(P.glass, s, .04, yy + wh / 2, ww, wh, .08);
        for (const e of [-1, 1]) box(P.trim, s + e * (ww / 2 + .08), .1, yy + wh / 2, .16, wh + .1, .14);
        box(P.trim, s, .12, yy - .06, ww + .5, .14, .26); box(P.trim, s, .12, yy + wh + .12, ww + .45, .22, .2);
        if (fl === 1) { const [x, z] = F.at(s, .1), tri = new THREE.Shape(); tri.moveTo(-.85, 0); tri.lineTo(.85, 0); tri.lineTo(0, .38); tri.closePath(); const tg = new THREE.ExtrudeGeometry(tri, { depth: .22, bevelEnabled: false }); if (side === 'e') tg.rotateY(Math.PI / 2); if (side === 'w') tg.rotateY(-Math.PI / 2); if (side === 'n') tg.rotateY(Math.PI); tg.translate(x, yy + wh + .25, z); PB.boxUV(tg, 1.6); this._push(P.trim, tg); }
      }
    }
  }
  /** 망사르 지붕: 가파른 아래 면(아연판) + 지붕창 + 굴뚝 */
  _mansard(x0, x1, z0, z1, y) {
    const P = this.P4, h = 3.2, inset = 1.1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, ang = Math.atan2(inset, h);
    for (const [sx, sz, len, ry] of [[0, -1, w, 0], [0, 1, w, 0], [-1, 0, d, Math.PI / 2], [1, 0, d, Math.PI / 2]]) {
      const g = new THREE.BoxGeometry(len, Math.hypot(h, inset), .16); g.rotateX(-(sz || sx) * ang * (sz ? 1 : 1)); if (ry) g.rotateY(ry);
      const px = cx + sx * (w / 2 - inset / 2), pz = cz + sz * (d / 2 - inset / 2); g.translate(px, y + h / 2, pz); PB.boxUV(g, 1.6); this._push(P.zinc, g);
    }
    this._b(P.zinc, w - inset * 2, .2, d - inset * 2, cx, y + h, cz);
    // 지붕창(길쭉한 면에만)
    for (const sz of [-1, 1]) for (let x = x0 + 2.5; x < x1 - 2; x += 4.2) { this._b(P.trim, 1.2, 1.5, .8, x, y + 1.2, cz + sz * (d / 2 - .7)); this._b(P.glass, .7, .9, .1, x, y + 1.2, cz + sz * (d / 2 - .28)); this._b(P.zinc, 1.4, .14, 1.0, x, y + 2.0, cz + sz * (d / 2 - .7)); }
    for (let x = x0 + 3; x < x1 - 2; x += 9) this._b(this.P4.trim, .9, 2.0, 1.6, x, y + h + .8, cz + rr(-d / 4, d / 4));   // 굴뚝
  }

  // ------------------------------------------------------------- 점령 건물(1층은 들어감)
  _wall(axis, a, b, fixed, y, h, t, mat, openings = [], hit = true) {
    const seg = (s0, s1, y0, y1) => { if (s1 - s0 < .02 || y1 - y0 < .02) return; const L = s1 - s0, m = (s0 + s1) / 2;
      if (axis === 'x') { this._b(mat, L, y1 - y0, t, m, y + (y0 + y1) / 2, fixed); if (hit) this._hit(m, y + (y0 + y1) / 2, fixed, L, y1 - y0, t, { collide: y0 < 1.2 }); }
      else { this._b(mat, t, y1 - y0, L, fixed, y + (y0 + y1) / 2, m); if (hit) this._hit(fixed, y + (y0 + y1) / 2, m, t, y1 - y0, L, { collide: y0 < 1.2 }); } };
    const ops = [...openings].sort((p, q) => p.c - q.c); let s = a;
    for (const o of ops) { seg(s, o.c - o.w / 2, 0, h); seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0); seg(o.c - o.w / 2, o.c + o.w / 2, o.y1, h); s = o.c + o.w / 2; }
    seg(s, b, 0, h);
  }
  _occupied() {
    const O = OCCUPIED, P = this.P4, y = STREET_H, T = .5;
    // 바깥벽(1층): 서쪽(큰길) 문·진열창, 북·남쪽 창, 동쪽은 막힘
    const W = [{ c: O.door.z, w: 1.6, y0: 0, y1: 2.8 }, { c: -8, w: 2.4, y0: .9, y1: 3.0 }, { c: 8, w: 2.4, y0: .9, y1: 3.0 }], N = [{ c: 26, w: 1.4, y0: 1.0, y1: 2.6 }], S = [{ c: 16, w: 1.4, y0: 1.0, y1: 2.6 }, { c: 27, w: 1.4, y0: 1.0, y1: 2.6 }];
    this._wall('z', O.z0, O.z1, O.x0, y, G1, T, P.stone, W); this._wall('x', O.x0, O.x1, O.z1, y, G1, T, P.stone, N);
    this._wall('x', O.x0, O.x1, O.z0, y, G1, T, P.stone, S); this._wall('z', O.z0, O.z1, O.x1, y, G1, T, P.stone);
    // 바깥벽 안쪽 면의 벽지(보이기만 함)
    const i = T / 2 + .015;
    this._wall('z', O.z0 + i, O.z1 - i, O.x0 + i, y, G1, .02, P.wallpaper, W, false); this._wall('x', O.x0 + i, O.x1 - i, O.z1 - i, y, G1, .02, P.wallpaper, N, false);
    this._wall('x', O.x0 + i, O.x1 - i, O.z0 + i, y, G1, .02, P.wallpaper, S, false); this._wall('z', O.z0 + i, O.z1 - i, O.x1 - i, y, G1, .02, P.wallpaper, [], false);
    // 안쪽 칸막이: 홀 | 옆방, 앞쪽 | 뒤쪽(창고·민간인 방)
    this._wall('x', O.x0 + T / 2, O.x1 - T / 2, -4, y, G1, .25, P.wallpaper, [{ c: 15, w: 1.3, y0: 0, y1: 2.3 }, { c: 26, w: 1.3, y0: 0, y1: 2.3 }]);
    this._wall('z', -4, O.z1 - T / 2, 20, y, G1, .25, P.wallpaper, [{ c: 6, w: 1.3, y0: 0, y1: 2.3 }]);
    this._wall('z', O.z0 + T / 2, -4, 22, y, G1, .25, P.wallpaper, [{ c: -9, w: 1.3, y0: 0, y1: 2.3 }]);
    // 안쪽 벽지(바깥벽 안면), 바닥, 천장
    this._b(P.floor, O.x1 - O.x0 - T, .06, O.z1 - O.z0 - T, (O.x0 + O.x1) / 2, y + .03, (O.z0 + O.z1) / 2);
    this._b(P.floor, O.x1 - O.x0, .3, O.z1 - O.z0, (O.x0 + O.x1) / 2, y + G1 + .15, (O.z0 + O.z1) / 2);
    this._hit((O.x0 + O.x1) / 2, y + G1 + .15, (O.z0 + O.z1) / 2, O.x1 - O.x0, .3, O.z1 - O.z0, { collide: false });
    // 위층 덩어리 + 서쪽 면 장식(1층 장식 생략)
    const up = { x0: O.x0, x1: O.x1, z0: O.z0, z1: O.z1 };
    this._b(P.stone, O.x1 - O.x0, TOP - G1, O.z1 - O.z0, (O.x0 + O.x1) / 2, y + G1 + (TOP - G1) / 2, (O.z0 + O.z1) / 2, 0, 4);
    this._hit((O.x0 + O.x1) / 2, y + G1 + (TOP - G1) / 2, (O.z0 + O.z1) / 2, O.x1 - O.x0, TOP - G1, O.z1 - O.z0, { collide: false });
    this._mansard(O.x0, O.x1, O.z0, O.z1, y + TOP); this._facade(up, 'w', true); this._facade(up, 'n', true);
    // 안쪽 소품: 의자·탁자·상자
    const drop = (key, x, z, fit, ry = 0) => { const m = this.assets.instantiate(key, fit ? { fit } : {}); if (m) { m.position.set(x, y + .05, z); m.rotation.y = ry; this.scene.add(m); } return m; };
    drop('props.table', 14, 7, [1.6, .8, .9], .3); for (const [x, z, r] of [[13, 5.5, .2], [15.6, 8, 2.8], [24, -12, 1.2], [29.5, -6, -.5]]) drop('props.chair', x, z, null, r);
    for (const [x, z] of [[11.5, -14.5], [12.6, -14.5], [11.5, -13.3]]) drop('props.crate', x, z, [1, .7, .9]);
  }

  // ------------------------------------------------------------- 구청(광장 북쪽)
  _hall() {
    const H = HALL, P = this.P4, y = STREET_H, x0 = H.x - H.w / 2, x1 = H.x + H.w / 2, z0 = H.z - H.d / 2, z1 = H.z + H.d / 2;
    const B = { x0, x1, z0, z1, streets: ['s'] }; this._block(B);
    // 가운데 정자각(조금 앞으로, 더 높게) + 기둥 현관 + 큰 시계
    this._b(P.stone, 18, TOP + 4, 3, 0, y + (TOP + 4) / 2, z1 + 1.5, 0, 4); this._hit(0, y + 10, z1 + 1.5, 18, 22, 3);
    for (let x = -7.5; x <= 7.5; x += 3) { const c = new THREE.CylinderGeometry(.42, .48, 9, 14); c.translate(x, y + 4.5, z1 + 3.6); PB.boxUV(c, 1.6); this._push(P.trim, c); this._hit(x, y + 4.5, z1 + 3.6, .9, 9, .9); }
    this._b(P.trim, 18, .9, 2.2, 0, y + 9.4, z1 + 3.3); this._b(P.door, 3, 5, .2, 0, y + 2.5, z1 + 3.05);
    // 정자각 정면: 큰 창 3개(틀·박공), 돌림띠, 꼭대기 박공
    for (const x of [-5, 0, 5]) { const fz = z1 + 3.04; this._b(P.glass, 1.7, 3.2, .06, x, y + 13.8, fz); for (const e of [-1, 1]) this._b(P.trim, .22, 3.4, .16, x + e * .96, y + 13.8, fz + .04); this._b(P.trim, 2.3, .22, .3, x, y + 12.1, fz + .06); this._b(P.trim, 2.2, .3, .24, x, y + 15.6, fz + .05); }
    this._b(P.trim, 18.4, .5, 3.6, 0, y + TOP + .1, z1 + 1.6); this._b(P.trim, 18.6, .6, 3.8, 0, y + TOP + 3.7, z1 + 1.6);
    { const tri = new THREE.Shape(); tri.moveTo(-9, 0); tri.lineTo(9, 0); tri.lineTo(0, 2.2); tri.closePath(); const tg = new THREE.ExtrudeGeometry(tri, { depth: .5, bevelEnabled: false }); tg.translate(0, y + 9.85, z1 + 3.9); PB.boxUV(tg, 1.6); this._push(P.trim, tg); }
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: .6 })); clock.position.set(0, y + TOP + 1.5, z1 + 3.06); this.scene.add(clock);
    // 깃대(해방 장면에서 삼색기가 올라감)
    this._b(P.trim, .16, 7, .16, 0, y + TOP + 4 + 3.5, z1 + 1.5);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2, 8, 1), P.flag); flag.position.set(1.6, y + TOP + 4.6, z1 + 1.5); flag.userData.dynamic = true; this.scene.add(flag); this.hallFlag = flag; this.flagTopY = y + TOP + 9.8;
  }
  /** 해방 장면: 구청 깃대에 삼색기가 오른다(t: 0~1) */
  raiseFlag(t) { const f = this.hallFlag; f.position.y = this.flagTopY - 5.2 * (1 - t); const p = f.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 1.5; p.setZ(i, Math.sin(u * 2.2 + performance.now() / 300) * .18 * u / 3); } p.needsUpdate = true; f.updateMatrix(); }

  // ------------------------------------------------------------- 검문소·바리케이드·카페·광장
  _bags(list) { const bagGeo = this._bagGeo || (this._bagGeo = this._modelGeometry('props.sandbag', (g) => { g.rotateY(Math.PI / 2); const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new V3()), c = b.getCenter(new V3()); g.translate(-c.x, -c.y, -c.z); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z); }) || new THREE.SphereGeometry(.5, 10, 7));
    const im = new THREE.InstancedMesh(bagGeo, this.M.bag, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; im.userData.keepShadow = true; this.scene.add(im); }
  _bagWall(x0, z0, x1, z1, rows, out) { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / .62)), a = Math.atan2(x1 - x0, z1 - z0);
    for (let r = 0; r < rows; r++) for (let i = 0; i < n + (r % 2); i++) { const t = clamp((i + .5 - (r % 2) * .5) / n, .03, .97), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; out.push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + .13 + r * .26, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + Math.PI / 2, 0)), new V3(.74, .34, .62))); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; this._hit(cx, heightAt(cx, cz) + rows * .13, cz, Math.abs(x1 - x0) + .5, rows * .26, Math.abs(z1 - z0) + .5, { surface: 'sand' }); }
  _checkpoint() {
    const P = this.P4, z = CHECKPOINT.z, bags = [];
    this._bagWall(-7, z + 3, -1.5, z + 3, 3, bags); this._bagWall(1.5, z - 2, 7, z - 2, 3, bags);
    this._bagWall(-6.5, z - 3, -1.5, z - 3, 3, bags); this._bagWall(-6.8, z - 3.4, -6.8, z - 6.5, 3, bags);   // MG 진지(서쪽, 남쪽을 향함)
    this._bags(bags);
    // 차단봉(빨강·흰색)과 초소
    this._b(P.trim, .25, 1.1, .25, 7.2, STREET_H + .55, z + 6); const bar = new THREE.BoxGeometry(7, .12, .12); bar.translate(3.6, STREET_H + 1.05, z + 6); const uv = bar.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3); this._push(P.redWhite, bar);
    this._b(P.door, 1.4, 2.4, 1.4, 8.4, STREET_H + 1.35, z + 8); this._hit(8.4, STREET_H + 1.2, z + 8, 1.4, 2.4, 1.4, { surface: 'wood' });
    const w = PB.barbedWire(new V3(-9.5, 0, z + 9), new V3(-3, 0, z + 9), heightAt), m1 = new THREE.Mesh(w.wire, this.PM.wire), m2 = new THREE.Mesh(w.posts, this.PM.wood); m1.userData.noShadow = true; this.scene.add(m1, m2);
    const mg = PB.mg42Geometry(); for (const [geo, mat] of [[mg.steel, this.PM.gun], [mg.wood, this.PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(-4, STREET_H + .95, z - 2.4); this.scene.add(m); }
    // 퀴벨바겐(각진 차체)
    const kM = new THREE.MeshStandardMaterial({ color: 0x77786a, roughness: .9, metalness: .05 }), k = new THREE.Group(), add = (geo, mat, x, y, zz, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, zz); m.rotation.x = rx; k.add(m); return m; };
    add(PB.roundedBox(1.55, .5, 3.6, .06), kM, 0, .62, 0);                              // 욕조 모양 차체
    add(PB.roundedBox(1.45, .14, 1.3, .05), kM, 0, .86, 1.15, -.18);                     // 비스듬한 보닛
    add(PB.roundedBox(1.5, .08, .06, .02), P.chrome, 0, 1.25, .45);                      // 앞유리 틀
    add(new THREE.PlaneGeometry(1.36, .38), P.glass, 0, 1.06, .45, -.2);                  // 앞유리
    add(new THREE.CylinderGeometry(.3, .3, .16, 14), P.tyre, 0, .95, -1.85, Math.PI / 2); // 뒤쪽 예비 바퀴
    for (const [x, zz] of [[-.36, -.4], [.36, -.4], [-.36, -1.2], [.36, -1.2]]) add(PB.roundedBox(.5, .35, .5, .06), P.door, x, .95, zz);   // 좌석
    for (const [x, zz] of [[-.8, 1.2], [.8, 1.2], [-.8, -1.2], [.8, -1.2]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .22, 14), P.tyre); wh.rotation.z = Math.PI / 2; wh.position.set(x, .34, zz); k.add(wh); }
    k.position.set(4.5, STREET_H, z + 11); k.rotation.y = .3; this.scene.add(k); this._hit(4.5, STREET_H + .7, z + 11, 2.2, 1.4, 4, { surface: 'metal' });
  }
  _barricade() {   // 서쪽 골목 입구의 레지스탕스 바리케이드: 보도블록 더미·뒤집힌 차·의자·수레, 삼색기
    const P = this.P4, x = -11.5, stones = [];
    for (const [z0, z1] of [[6.5, 8.8], [11.2, 13.5]]) { for (let i = 0; i < 70; i++) { const z = rr(z0, z1), xx = x + rr(-.8, .8), hh = rr(0, 1.2); stones.push(new THREE.Matrix4().compose(new V3(xx, STREET_H + hh * (1 - Math.abs(z - (z0 + z1) / 2) / 2), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 3, rnd())), new V3(.22, .14, .16))); }
      this._hit(x, STREET_H + .6, (z0 + z1) / 2, 1.8, 1.2, z1 - z0, { surface: 'concrete' }); }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), P.paving, stones.length); stones.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.userData.keepShadow = true; this.scene.add(im);
    const car = this._car(P.carBurnt); car.position.set(x - 2.2, STREET_H + .9, 12.6); car.rotation.set(0, .2, Math.PI / 2 - .1); this.scene.add(car);
    for (const [cx, cz, r] of [[x + .6, 9.2, .5], [x - .4, 10.8, 2.2], [x + .3, 6.2, 1.4]]) { const c = this.assets.instantiate('props.chair'); if (c) { c.position.set(cx, STREET_H + .5, cz); c.rotation.set(rr(-.6, .6), r, rr(-.4, .4)); this.scene.add(c); } }
    this._b(P.door, .1, 3.2, .1, x - .6, STREET_H + 1.6, 7.2); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1), P.flag); fl.position.set(x - .6, STREET_H + 2.7, 7.95); fl.rotation.y = Math.PI / 2; this.scene.add(fl);
    // 골목 창문에 걸린 삼색기
    for (const [fx, fz] of [[-10.3, 20], [-10.3, 2], [-10.3, 48]]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), P.flag); f.position.set(fx - .05, STREET_H + G1 + FL + 1.2, fz); f.rotation.y = Math.PI / 2; this.scene.add(f); }
  }
  _cafe() {   // 카페 테라스: 둥근 탁자·의자·차양
    const P = this.P4;
    for (const [x, z] of [[-9, 58.5], [-9, 62.5], [-8.6, 66.5], [-12, 60.5]]) {
      const t = new THREE.Group(), top = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .04, 16), P.trim); top.position.y = .74; t.add(top); const leg = new THREE.Mesh(new THREE.CylinderGeometry(.04, .06, .72, 8), P.car); leg.position.y = .36; t.add(leg);
      t.position.set(x, heightAt(x, z), z); this.scene.add(t);
      for (const a of [0, 2.4]) { const c = this.assets.instantiate('props.chair'); if (c) { c.position.set(x + Math.cos(a) * .7, heightAt(x, z), z + Math.sin(a) * .7); c.rotation.y = -a + Math.PI / 2; this.scene.add(c); } }
    }
    const ag = new THREE.PlaneGeometry(9, 2.2); ag.rotateX(-Math.PI / 2 - .45); ag.rotateY(Math.PI / 2); ag.translate(-9.1, STREET_H + 3.0, 72); this._push(P.awning, ag);
  }
  _square() {
    const bags = [];
    for (const [cx, cz, r] of [[0, -70, 2], [-22, -60, 1.6], [24, -78, 1.6]]) for (let a = .3; a < Math.PI - .3; a += .62 / r) { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; bags.push(new THREE.Matrix4().compose(new V3(x, STREET_H + .13, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0)), new V3(.74, .34, .62))); bags.push(new THREE.Matrix4().compose(new V3(x, STREET_H + .39, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0)), new V3(.74, .34, .62))); }
    for (const [cx, cz, r] of [[0, -70, 2], [-22, -60, 1.6], [24, -78, 1.6]]) this._hit(cx, STREET_H + .3, cz + r * .7, r * 2, .6, .6, { surface: 'sand' });
    this._bagWall(-36, -50, -26, -50, 3, bags); this._bagWall(26, -52, 36, -52, 3, bags); this._bagWall(-10, -84, 10, -84, 2, bags);
    this._bags(bags);
    const mg = PB.mg42Geometry(); for (const [geo, mat] of [[mg.steel, this.PM.gun], [mg.wood, this.PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(0, STREET_H + .95, -69.3); this.scene.add(m); }
    // 광장 네 모서리 나무, 가운데 분수 받침(돌)
    for (const [x, z] of [[-38, -48], [38, -48], [-38, -88], [38, -88]]) this._tree(x, z, 1.2);
    this._b(this.P4.trim, 6, .7, 6, 0, STREET_H + .35, -58); this._hit(0, STREET_H + .35, -58, 6, .7, 6);
  }
  _car(mat) {   // 시트로엥 트락시옹 아방: 긴 보닛, 둥근 지붕, 흙받기, 큰 바퀴
    const g = new THREE.Group(), P = this.P4;
    const body = new THREE.Mesh(PB.roundedBox(1.7, .55, 4.4, .2), mat); body.position.y = .62; g.add(body);
    const cab = new THREE.Mesh(PB.roundedBox(1.55, .62, 2.2, .3), mat); cab.position.set(0, 1.18, -.35); g.add(cab);
    const win = new THREE.Mesh(PB.roundedBox(1.58, .4, 2.0, .2), P.glass); win.position.set(0, 1.22, -.35); g.add(win);
    for (const [x, z] of [[-.78, 1.35], [.78, 1.35], [-.78, -1.45], [.78, -1.45]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .2, 16), P.tyre); w.rotation.z = Math.PI / 2; w.position.set(x, .36, z); g.add(w); const f = new THREE.Mesh(new THREE.CylinderGeometry(.44, .44, .26, 12, 1, false, 0, Math.PI), mat); f.rotation.set(0, 0, Math.PI / 2); f.position.set(x, .4, z); g.add(f); }
    const grille = new THREE.Mesh(PB.roundedBox(.9, .4, .06, .03), P.chrome); grille.position.set(0, .7, 2.22); g.add(grille);
    return g;
  }
  _cars() {
    for (const [x, z, ry, burnt] of [[-8.3, 92, 0, false], [8.4, 80, Math.PI, false], [-8.3, 26, .05, true], [8.3, 66, Math.PI, false], [8.4, -30, Math.PI + .1, true], [-20, -76, 1.2, false]]) {
      const c = this._car(burnt ? this.P4.carBurnt : this.P4.car); c.position.set(x, heightAt(x, z), z); c.rotation.y = ry; this.scene.add(c); this._hit(x, heightAt(x, z) + .8, z, Math.abs(Math.sin(ry)) > .5 ? 4.4 : 1.8, 1.6, Math.abs(Math.sin(ry)) > .5 ? 1.8 : 4.4, { surface: 'metal' });
    }
  }
  /** 플라타너스: 얼룩진 줄기 + 둥근 수관(잎 무늬 덩어리) */
  _tree(x, z, s = 1) {
    const y = heightAt(x, z), th = 5.5 * s; this._b(this.P4.bark, .38 * s, th, .38 * s, x, y + th / 2, z);
    for (let i = 0; i < 7; i++) { const g = new THREE.IcosahedronGeometry(1.5 * s * rr(.7, 1.1), 1), a = rnd() * 6.28, d = rr(.3, 1.6) * s; g.translate(x + Math.cos(a) * d, y + th + rr(-.4, 1.6) * s, z + Math.sin(a) * d); PB.boxUV(g, 1.2); this._push(this.P4.leaf, g); }
    this._hit(x, y + th / 2, z, .5 * s, th, .5 * s, { surface: 'wood' });
  }
  _street() {
    // 가로수와 가로등(번갈아), 모리스 기둥, 벤치
    const lamps = []; let lampParts = null;
    for (let z = 96, k = 0; z > -40; z -= 7, k++) for (const sx of [-1, 1]) {
      const x = sx * 8.6; if (Math.abs(z - CHECKPOINT.z) < 9 || Math.abs(z - CAFE.z) < 8 || (Math.abs(z - 10) < 6 && sx < 0)) continue;
      if (k % 2 === 0) this._tree(x, z, rr(.9, 1.1));
      else { const m = this.assets.instantiate('props.streetlamp', { fit: [1, 4.6, 1] }); if (m) { m.position.set(x, heightAt(x, z), z); m.rotation.y = sx > 0 ? Math.PI : 0; m.updateMatrixWorld(true); if (!lampParts) lampParts = partsOf(m); lamps.push(m.matrixWorld.clone()); this._hit(x, heightAt(x, z) + 2.3, z, .3, 4.6, .3, { surface: 'metal' }); } }
    }
    if (lampParts) this.lods.push(new InstanceLOD(this.scene, lampParts, lamps, { near: 40, far: 110 }));
    for (const [x, z] of [[-8.8, 84], [8.8, -12]]) { const c = new THREE.CylinderGeometry(.6, .6, 3, 14); c.translate(x, STREET_H + 1.65, z); PB.boxUV(c, 1.2); this._push(this.P4.poster, c); const cap = new THREE.SphereGeometry(.7, 14, 6, 0, 6.28, 0, 1.4); cap.translate(x, STREET_H + 3.15, z); PB.boxUV(cap, 1.6); this._push(this.P4.morris, cap); this._hit(x, STREET_H + 1.6, z, 1.2, 3.2, 1.2); }
    // 흩어진 종이·잔해
    for (let i = 0; i < 40; i++) { const x = rr(-9, 9), z = rr(-40, 100), pg = new THREE.PlaneGeometry(.3, .21); pg.rotateX(-Math.PI / 2); pg.rotateY(rnd() * 6); pg.translate(x, heightAt(x, z) + .02, z); this._push(this.P4.trim, pg); }
  }
}
