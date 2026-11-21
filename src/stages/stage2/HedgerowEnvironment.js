// Stage 2 전장 그래픽 — 노르망디 보카주(생울타리 지대): 흙둑 위의 빽빽한 덤불 벽, 움푹 꺼진 농로, 들판, 과수원·숲,
// 석조 농가와 헛간, 독일군 참호·기관총 진지·박격포 진지·저격 망루.
// EnvironmentManager 를 이어받아 하늘·재질·보급품·품질 전환·충돌 상자 도우미를 그대로 쓰고, 지형과 소품만 새로 만든다.
// 충돌(colliders)과 사격 판정(solids)은 보이지 않는 상자로 따로 만든다(생울타리는 총알·시야를 막고, 사격 구멍으로는 쏠 수 있다).
import * as THREE from 'three';
import { EnvironmentManager } from '../../graphics/EnvironmentManager.js';
import { createTerrainMaterial } from '../../graphics/TerrainMaterial.js';
import { InstanceLOD, mergedClone } from '../../graphics/InstanceLOD.js';
import * as PB from '../../graphics/PropBuilder.js';
import { mergeVertices } from '../../../vendor/jsm/utils/BufferGeometryUtils.js';
import { heightAt, solids, colliders } from '../../game/world.js';
import { V3, clamp } from '../../core/utils.js';
import { HEDGES, SNIPER, MG_NEST, MORTAR, FARMHOUSE, BARN, CP_ROOM, HAYSTACK_FIRE, TRENCH, WOODS } from './layout.js';
import { FARM_H, CRATERS2 } from './terrain.js';

const LAYERS = [
  { name: 'leafy_grass', tile: 3.4, rough: .95 },        // 0 들판 풀
  { name: 'muddy_tracks', tile: 3.2, rough: .7 },        // 1 농로·마당의 바퀴 자국 진흙
  { name: 'sparse_grass', tile: 3.0, rough: .95 },       // 2 듬성듬성한 풀(얼룩)
  { name: 'brown_mud', tile: 2.6, rough: .62 },          // 3 진흙(생울타리 밑·참호·구덩이)
  { name: 'forest_leaves_02', tile: 2.8, rough: .9 },    // 4 숲·과수원 바닥의 낙엽
  { name: 'burned_ground_01', tile: 3.0, rough: .95 },   // 5 포탄 자국
];
const HT = 2.2;       // 생울타리 두께
const BANK = 1.1;     // 흙둑 높이

// 결정적 난수(같은 배치)
let seed = 19440612; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const rr = (a, b) => a + rnd() * (b - a);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class HedgerowEnvironment extends EnvironmentManager {
  constructor(deps) { super(deps); this.smokeSources = [[HAYSTACK_FIRE.x, HAYSTACK_FIRE.z]]; this.stageId = 2; }

  build() {
    this.lods = []; this.gfxSwap = [];
    this.PM = this._materials(); this._stage2Materials();
    this._terrain2();
    this._skyAndWater(); this.water.visible = false;   // 바다 없음(하늘·안개만)
    this.foliage = { items: [], colors: [] }; this.sprays = [];   // 덤불 덩어리·잎 카드 위치(마지막에 한꺼번에 인스턴싱)
    this._hedges();
    this._trees();
    this._farm();
    this._military();
    this._props2();
    this._foliageInstances();
    this._groundCover2();
    // 움직이지 않는 물체는 행렬 계산 생략(EnvironmentManager.build 와 같은 마무리)
    const lodMeshes = new Set(); for (const l of this.lods) for (const L of l.levels) for (const im of [L.near, L.mid, L.far]) if (im) lodMeshes.add(im);
    this.scene.traverse((o) => { if (o.isMesh && !lodMeshes.has(o) && !o.userData.keepShadow && o !== this.terrain && o !== this.water && o !== this.sky) { o.castShadow = o.visible && !o.userData.noShadow; o.receiveShadow = true; } });
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => { if (o !== this.scene && o !== this.sky && o !== this.water && !o.isLight && o !== this.lighting.sun.target) o.matrixAutoUpdate = false; });
    for (const l of this.lods) l.update(new V3(0, 2, 96), true);
  }

  // ------------------------------------------------------------- 재질
  _stage2Materials() {
    const a = this.assets, S = (o) => new THREE.MeshStandardMaterial(o);
    const leafTex = this._leafTexture(), sprayTex = this._sprayTexture();
    this.P2 = {
      bank: S({ color: 0xa79c86, side: THREE.DoubleSide, ...a.pbr('forest_leaves_02', .5, .5) }),
      foliage: S({ map: leafTex, color: 0xffffff, roughness: .9, metalness: 0 }),
      spray: S({ map: sprayTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .9, color: 0xffffff }),
      bark: S({ color: 0xb8aa98, ...a.pbr('bark_brown_02', .6, 1.6) }),
      stone: S({ color: 0xd8d0c4, ...a.pbr('rustic_stone_wall', .4, .4) }),
      slate: S({ color: 0xb4b8bc, ...a.pbr('grey_roof_tiles', .5, .5) }),
      roofPlank: S({ color: 0xa89480, ...a.pbr('roof_planks', .5, .5) }),
      planks: S({ color: 0xa08a70, ...a.pbr('weathered_planks', .5, .5) }),
      floor: S({ color: 0x9c8a74, ...a.pbr('fine_grained_wood', .5, .5) }),
      plaster: S({ color: 0xcfc6b2, roughness: .95 }),
      hay: S({ color: 0xc9b06a, ...a.pbr('sparse_grass', .6, .6) }),
      hayBurnt: S({ color: 0x2c2620, roughness: 1 }),
      window: new THREE.MeshBasicMaterial({ color: 0x0b0c0d }),
      paper: S({ color: 0xd8cfb4, roughness: 1 }),
      dark: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    };
  }
  /** 잎 무늬(덤불 덩어리 표면): 어두운 바탕에 여러 녹색의 잎 모양을 겹쳐 그린다 */
  _leafTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#1f2a14'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * 512, y = rnd() * 512, s = 3.5 + rnd() * 7, l = 12 + rnd() * 30, hue = 72 + rnd() * 32;
      g.save(); g.translate(x, y); g.rotate(rnd() * 6.28); g.fillStyle = `hsl(${hue},${35 + rnd() * 25}%,${l}%)`;
      g.beginPath(); g.ellipse(0, 0, s, s * .45, 0, 0, 6.28); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  /** 잎 카드(가장자리 실루엣용): 투명 바탕에 잔가지와 잎 다발 */
  _sprayTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.strokeStyle = '#3a2e1e'; g.lineWidth = 2;
    for (let b = 0; b < 7; b++) { g.beginPath(); g.moveTo(128, 256); g.quadraticCurveTo(128 + (rnd() - .5) * 120, 150, 30 + rnd() * 196, 20 + rnd() * 120); g.stroke(); }
    for (let i = 0; i < 420; i++) {
      const y = 10 + Math.pow(rnd(), .8) * 210, x = 128 + (rnd() - .5) * (40 + (230 - y) * .9), s = 5 + rnd() * 8;
      g.save(); g.translate(x, y); g.rotate(rnd() * 6.28); g.fillStyle = `hsl(${72 + rnd() * 30},${35 + rnd() * 25}%,${16 + rnd() * 26}%)`;
      g.beginPath(); g.ellipse(0, 0, s, s * .45, 0, 0, 6.28); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ------------------------------------------------------------- 지형
  _terrain2() {
    const W = 172, D = 224, cx = 0, cz = 4;
    const g = new THREE.PlaneGeometry(W, D, 172, 224); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sa = new Float32Array(n * 4), sb = new Float32Array(n * 2);
    const noise = (x, z) => Math.sin(x * .37 + z * .21) * .5 + Math.sin(x * .13 - z * .29 + 2.) * .5;
    const hedgeD = (x, z) => { let d = 1e9; for (const h of HEDGES) { const [ax, az] = h.a, [bx, bz] = h.b; if (ax === bx) { if (z > Math.min(az, bz) - 1 && z < Math.max(az, bz) + 1) d = Math.min(d, Math.abs(x - ax)); } else if (x > Math.min(ax, bx) - 1 && x < Math.max(ax, bx) + 1) d = Math.min(d, Math.abs(z - az)); } return d; };
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
      const nz = noise(x, z), hd = hedgeD(x, z);
      let track = 0, patchy = clamp(.08 + nz * .3, 0, .35), mud = 0, leaves = 0, burn = 0;
      if (z > 56 && Math.abs(x) < 4.2) track = clamp(1 - Math.abs(x) / 4.2 + .3, 0, 1);                       // 출발 농로
      if (Math.abs(x + 6) < 3.4 && z < -40 && z > -60) track = Math.max(track, .9);                             // 농장 길
      if (z < -52 && z > -90 && x > -34 && x < 44) track = Math.max(track, clamp(.35 + nz * .35, 0, .8));       // 농장 마당
      mud = clamp(1.6 - hd / 1.6, 0, 1) * .85;                                                                   // 생울타리 밑
      if (z > TRENCH.minZ - 1.2 && z < TRENCH.maxZ + 1.2 && x > TRENCH.minX - 2 && x < TRENCH.maxX + 2) mud = Math.max(mud, .95);
      if (Math.hypot(x - MORTAR.x, z - MORTAR.z) < 5) mud = Math.max(mud, .8);
      for (const w of WOODS) { const d = Math.hypot(x - w.x, z - w.z); if (d < w.r + 3) leaves = Math.max(leaves, ss(w.r + 3, w.r - 2, d) * .9); }
      for (const c of CRATERS2) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r * 1.5) burn = Math.max(burn, clamp(1 - d / (c.r * 1.2), 0, 1) * .9); }
      let s = track + patchy + mud + leaves + burn; if (s > 1) { track /= s; patchy /= s; mud /= s; leaves /= s; burn /= s; }
      sa[i * 4] = track; sa[i * 4 + 1] = patchy; sa[i * 4 + 2] = mud; sa[i * 4 + 3] = leaves; sb[i * 2] = burn;
      // 들판(풀) 부분은 초록으로 물들여 노르망디의 젖은 목초지처럼, 진흙 길은 채도를 조금 뺀다
      const j = .9 + Math.random() * .12, gW = clamp(1 - track - mud - leaves - burn, 0, 1);
      col[i * 3] = j * (1 - .2 * gW) * (1 - .1 * track); col[i * 3 + 1] = j * (1 + .04 * gW) * (1 - .12 * track); col[i * 3 + 2] = j * (1 - .32 * gW) * (1 - .14 * track);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2));
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, createTerrainMaterial(this.assets, LAYERS)); this.terrain.receiveShadow = true; this.scene.add(this.terrain);
    this.grassLayer = null;
  }

  // ------------------------------------------------------------- 생울타리
  /** 선분을 출입구로 나눈 조각들 [[s0, s1], ...] (선분 방향 좌표) */
  _pieces(h) {
    const along = h.a[0] === h.b[0] ? 1 : 0, s0 = Math.min(h.a[along], h.b[along]), s1 = Math.max(h.a[along], h.b[along]);
    const cuts = (h.gaps || []).map(([c, w]) => [c - w / 2, c + w / 2]).sort((x, y) => x[0] - y[0]);
    const out = []; let s = s0; for (const [g0, g1] of cuts) { if (g0 > s) out.push([s, g0]); s = Math.max(s, g1); } if (s < s1) out.push([s, s1]);
    return { along, fixed: h.a[1 - along], pieces: out };
  }
  _hedges() {
    const bankParts = [];
    for (const h of HEDGES) {
      const { along, fixed, pieces } = this._pieces(h), holes = h.holes || [];
      const P = (s, off) => (along ? [fixed + off, s] : [s, fixed + off]);   // 선분 좌표 → (x, z)
      for (const [s0, s1] of pieces) {
        // 1) 흙둑: 지형을 따라가는 사다리꼴 단면 띠
        bankParts.push(this._bankStrip(P, s0, s1));
        // 2) 덤불 덩어리: 두 줄 + 위층, 사격 구멍 자리는 아래층을 비운다
        for (let s = s0 + .4; s < s1 - .3; s += .62) {
          const nearHole = holes.some((hx) => Math.abs(hx - s) < 1.15);
          for (const off of [-.55, .55]) {
            const [x, z] = P(s + rr(-.25, .25), off + rr(-.2, .2)), gy = this._bankTop(x, z);
            if (!nearHole) this._blob(x, gy + rr(.3, .65), z, rr(.75, 1.1), along);
            this._blob(x, gy + rr(1.35, 1.9), z, rr(.7, 1.05), along);
          }
          if (rnd() < .45) { const [x, z] = P(s, rr(-.3, .3)), gy = this._bankTop(x, z); this._blob(x, gy + rr(2.3, 2.9), z, rr(.55, .9), along); }   // 위로 삐죽 솟은 덩어리
          // 잎 카드: 위쪽 가장자리와 양옆(실루엣을 거칠게)
          if (rnd() < .7) { const [x, z] = P(s, rr(-.3, .3)); this._spray(x, this._bankTop(x, z) + rr(2.4, 3.2), z, rr(1.2, 1.9)); }
          for (const sd of [-1, 1]) if (rnd() < .6) { const [x, z] = P(s, sd * rr(1.0, 1.35)); this._spray(x, this._bankTop(x, z) + rr(.2, 2.0), z, rr(1.0, 1.6)); }
        }
        // 3) 판정: 12m 단위 상자(지형 높이에 맞춤). 아래는 흙둑, 위는 덤불. 사격 구멍은 0.9~1.9m 높이에서 비운다
        for (let s = s0; s < s1 - .01; s += 12) {
          const e = Math.min(s1, s + 12), m = (s + e) / 2, [cx, cz] = P(m, 0);
          let gmin = 1e9, gmax = -1e9; for (let t = s; t <= e; t += 2) { const [x, z] = P(t, 0); const y = heightAt(x, z); gmin = Math.min(gmin, y); gmax = Math.max(gmax, y); }
          const len = e - s, sx = along ? HT : len, sz = along ? len : HT, top = gmax + BANK + 2.6;
          colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, minY: gmin - 1, maxY: top + 2 });
          const solid = (a, b, y0, y1) => { if (b - a < .05 || y1 - y0 < .05) return; const mm = (a + b) / 2, [x, z] = P(mm, 0), L = b - a; const box = new THREE.Mesh(new THREE.BoxGeometry(along ? HT * .8 : L, y1 - y0, along ? L : HT * .8), this.PM.dark); box.position.set(x, (y0 + y1) / 2, z); box.visible = false; box.userData.surface = 'wood'; this.scene.add(box); solids.push(box); };
          solid(s, e, gmin - .5, gmin + .9 + (gmax - gmin));                                // 흙둑
          const hs = holes.filter((hx) => hx > s && hx < e).sort((a, b) => a - b); let c0 = s;
          for (const hx of hs) { solid(c0, hx - .95, gmin + .9, top); solid(hx - .95, hx + .95, gmax + 1.95, top); c0 = hx + .95; }   // 구멍 위는 계속 막힘
          solid(c0, e, gmin + .9, top);
        }
      }
      // 생울타리 나무(보카주의 큰 나무): 경계선이 아닌 생울타리에 15~25m 마다
      if (!(Math.abs(fixed) > 70 || fixed === 104 || fixed === -96)) for (const [s0, s1] of pieces) for (let s = s0 + rr(4, 12); s < s1 - 3; s += rr(15, 26)) { const [x, z] = P(s, rr(-.3, .3)); this._tree(x, z, 'oak', rr(.85, 1.2)); }
    }
    const bank = new THREE.Mesh(mergeStrips(bankParts), this.P2.bank); bank.receiveShadow = true; this.scene.add(bank);
  }
  _bankTop(x, z) { return heightAt(x, z) + BANK; }
  /** 흙둑 띠 지오메트리: 2m 간격으로 단면(바깥 바닥 → 위 → 위 → 안쪽 바닥) */
  _bankStrip(P, s0, s1) {
    const pos = [], uv = [], idx = []; const prof = [[-HT * .62, -.35], [-HT * .3, 0], [HT * .3, 0], [HT * .62, -.35]];
    let row = 0;
    for (let s = s0; ; s = Math.min(s1, s + 2)) {
      const [cx, cz] = P(s, 0), top = this._bankTop(cx, cz);
      prof.forEach(([o, dy], k) => { const [x, z] = P(s, o), base = heightAt(x, z); const y = k === 0 || k === 3 ? base + dy : top + Math.sin(s * 1.7 + k) * .08; pos.push(x, y, z); uv.push(s / 2.2, k * .6); });
      if (row > 0) for (let k = 0; k < 3; k++) { const a = (row - 1) * 4 + k, b = a + 1, c = row * 4 + k, d = c + 1; idx.push(a, c, b, b, c, d); }
      row++; if (s >= s1) break;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // 방향이 반대인 선분은 앞뒤가 뒤집히므로 양면으로 보이게 노멀을 위로 맞춘다
    const nrm = g.attributes.normal; let up = 0; for (let i = 0; i < nrm.count; i++) up += nrm.getY(i); if (up < 0) { g.setIndex(idx.map((v, i) => (i % 3 === 1 ? idx[i + 1] : i % 3 === 2 ? idx[i - 1] : v))); g.computeVertexNormals(); }
    return g;
  }
  _blob(x, y, z, s, along) {
    const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 6.28, rnd() * 3)), new V3(s * rr(.9, 1.3), s * rr(.75, 1), s * rr(.9, 1.3)));
    this.foliage.items.push(m); const v = rr(.72, 1.12); this.foliage.colors.push(new THREE.Color(v * rr(.9, 1.05), v, v * rr(.75, .95)));
  }
  _spray(x, y, z, s) { this.sprays.push(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-.25, .25), rnd() * 3.14, rr(-.25, .25))), new V3(s, s, s))); }
  _foliageInstances() {
    // 덤불 덩어리: 가까이(45m)는 80면체+그림자, 멀리는 20면체 그림자 없이
    const blob = jitter(new THREE.IcosahedronGeometry(1, 1), .28), low = jitter(new THREE.IcosahedronGeometry(1, 0), .2);
    this.lods.push(new InstanceLOD(this.scene, [{ geometry: blob, material: this.P2.foliage, low }], this.foliage.items, { near: 45, lowShadow: false, colors: this.foliage.colors }));
    // 잎 카드(십자 사각형 두 장): 실루엣을 거칠게. 70m 밖은 생략
    const a = new THREE.PlaneGeometry(1, 1), b = a.clone().rotateY(Math.PI / 2), cross = mergeStrips([a, b]);
    this.lods.push(new InstanceLOD(this.scene, [{ geometry: cross, material: this.P2.spray }], this.sprays, { near: 30, far: 70 }));
  }

  // ------------------------------------------------------------- 나무
  _trees() {
    for (const w of WOODS) for (let i = 0; i < w.n; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * w.r; this._tree(w.x + Math.cos(a) * r, w.z + Math.sin(a) * r, w.kind, rr(.8, 1.15)); }
    // 저격 망루가 있는 큰 나무
    this._tree(SNIPER.x + .9, SNIPER.z - .6, 'oak', 1.35, true);
  }
  _tree(x, z, kind, s = 1, noCanopyLow = false) {
    const orchard = kind === 'orchard', gy = heightAt(x, z), trunkH = (orchard ? 2.2 : rr(5.5, 7.5)) * s, r = (orchard ? .16 : rr(.26, .4)) * s;
    (this._trunks || (this._trunks = [])).push(new THREE.Matrix4().compose(new V3(x, gy + trunkH / 2 - .1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-.05, .05), rnd() * 6.28, rr(-.05, .05))), new V3(r, trunkH, r)));
    const cy = gy + trunkH + (orchard ? .5 : -.4), n = orchard ? 8 : 16, cr = (orchard ? 1.4 : 2.6) * s;
    for (let i = 0; i < n; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * cr * 1.1; this._blob(x + Math.cos(a) * d, cy + rr(-.9, 1.6) * s, z + Math.sin(a) * d, cr * rr(.35, .6), 0); }
    for (let i = 0; i < (orchard ? 6 : 12); i++) { const a = rnd() * 6.28, d = cr * rr(.8, 1.25); this._spray(x + Math.cos(a) * d, cy + rr(-.8, 1.6) * s, z + Math.sin(a) * d, cr * rr(.5, .8)); }
    // 줄기 판정(총알·이동)
    colliders.push({ minX: x - r - .15, maxX: x + r + .15, minZ: z - r - .15, maxZ: z + r + .15, minY: gy - 1, maxY: gy + trunkH });
    const sb = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, trunkH, r * 1.6), this.PM.dark); sb.position.set(x, gy + trunkH / 2, z); sb.visible = false; sb.userData.surface = 'wood'; this.scene.add(sb); solids.push(sb);
    if (!this._trunkLOD) this._trunkLOD = true;
  }

  // ------------------------------------------------------------- 농장
  /** 축에 나란한 벽 하나(문·창문 구멍 포함). axis 'x' = x 방향으로 뻗은 벽(z 고정). openings: [{ c, w, y0, y1 }] (벽 좌표, 바닥 기준 높이) */
  _wall(axis, a, b, fixed, y, h, t, mat, openings = []) {
    const seg = (s0, s1, y0, y1) => { if (s1 - s0 < .02 || y1 - y0 < .02) return; const L = s1 - s0, m = (s0 + s1) / 2;
      if (axis === 'x') this.addBox(L, y1 - y0, t, m, y + (y0 + y1) / 2, fixed, mat); else this.addBox(t, y1 - y0, L, fixed, y + (y0 + y1) / 2, m, mat); };
    const ops = [...openings].sort((p, q) => p.c - q.c); let s = a;
    for (const o of ops) { seg(s, o.c - o.w / 2, 0, h); seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0); seg(o.c - o.w / 2, o.c + o.w / 2, o.y1, h); s = o.c + o.w / 2;
      // 창문: 어두운 유리 대신 안쪽이 보이는 빈 틀 + 나무 덧문 하나
      if (o.y0 > .3) { const fx = axis === 'x' ? o.c : fixed, fz = axis === 'x' ? fixed : o.c; const sh = new THREE.Mesh(this.boxGeo(axis === 'x' ? o.w * .5 : .06, o.y1 - o.y0, axis === 'x' ? .06 : o.w * .5), this.P2.planks);
        sh.position.set(fx + (axis === 'x' ? -o.w * .75 : t * .6), y + (o.y0 + o.y1) / 2, fz + (axis === 'x' ? t * .6 : -o.w * .75)); sh.rotation.y = axis === 'x' ? .5 : -.5; this.scene.add(sh); } }
    seg(s, b, 0, h);
  }
  /** 박공지붕(용마루가 x 방향) + 양쪽 박공벽(삼각형) */
  _gableRoof(cx, cz, w, d, y, rise, mat, wallMat) {
    const over = .45, half = d / 2 + over, L = w + over * 2;
    const shape = new THREE.Shape(); shape.moveTo(-half, 0); shape.lineTo(half, 0); shape.lineTo(0, rise + over * rise / (d / 2)); shape.closePath();
    // 지붕면 두 장(두께 0.18)
    for (const sgn of [-1, 1]) {
      const slope = Math.hypot(half, rise + over * rise / (d / 2)), ang = Math.atan2(rise + over * rise / (d / 2), half);
      const g = this.boxGeo(L, .18, slope, .5), m = new THREE.Mesh(g, mat);
      m.position.set(cx, y + (rise + over * rise / (d / 2)) / 2 - .05, cz + sgn * half / 2); m.rotation.x = sgn * ang; this.scene.add(m);
    }
    // 박공벽(벽 위 삼각형)
    for (const sx of [-1, 1]) { const tri = new THREE.Shape(); tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, rise); tri.closePath();
      const g = new THREE.ExtrudeGeometry(tri, { depth: .5, bevelEnabled: false }); PB.boxUV(g, 2.5); const m = new THREE.Mesh(g, wallMat); m.rotation.y = Math.PI / 2; m.position.set(cx + sx * (w / 2) - (sx > 0 ? .5 : 0) + (sx > 0 ? .25 : .25), y, cz); this.scene.add(m); }
  }
  _farm() {
    const P = this.P2, F = FARMHOUSE, y = FARM_H, x0 = F.x - F.w / 2, x1 = F.x + F.w / 2, zS = F.z + F.d / 2, zN = F.z - F.d / 2, T = .55;
    // 석조 농가: 남쪽 벽에 문 2개(동쪽 방 문 + 지휘소 창), 칸막이 벽에 안쪽 문
    const win = (c) => ({ c, w: 1.0, y0: 1.0, y1: 2.15 }), door = (c, w = 1.3) => ({ c, w, y0: 0, y1: 2.3 });
    this._wall('x', x0, x1, zS, y, F.h, T, P.stone, [door(-9.6), win(-18), win(-5.2)]);
    this._wall('x', x0, x1, zN, y, F.h, T, P.stone, [win(-17.5), win(-10)]);
    this._wall('z', zN, zS, x0, y, F.h, T, P.stone, [win(F.z)]);
    this._wall('z', zN, zS, x1, y, F.h, T, P.stone, [win(F.z + 1)]);
    this._wall('z', zN + T / 2, zS - T / 2, CP_ROOM.maxX, y, F.h, .3, P.plaster, [door(F.z + 1.2, 1.1)]);   // 지휘소 칸막이
    this._gableRoof(F.x, F.z, F.w, F.d, y + F.h, 3.0, P.slate, P.stone);
    const fl = new THREE.Mesh(this.boxGeo(F.w - T, .08, F.d - T, .5), P.floor); fl.position.set(F.x, y + .04, F.z); this.scene.add(fl);
    const ceil = new THREE.Mesh(this.boxGeo(F.w - T, .12, F.d - T, .5), P.planks); ceil.position.set(F.x, y + F.h - .06, F.z); this.scene.add(ceil);
    this.addBox(1.1, 3.4, 1.1, x0 + .9, y + F.h + 1.4, F.z - 1.5, P.stone, { collide: false });    // 굴뚝
    // 헛간: 남쪽이 열린 판자 벽 + 판자 지붕, 기둥 2개
    const B = BARN, bx0 = B.x - B.w / 2, bx1 = B.x + B.w / 2, bzS = B.z + B.d / 2, bzN = B.z - B.d / 2;
    this._wall('x', bx0, bx1, bzN, y, B.h, .25, P.planks);
    this._wall('z', bzN, bzS, bx0, y, B.h, .25, P.planks, [door(B.z + 2, 1.4)]);
    this._wall('z', bzN, bzS, bx1, y, B.h, .25, P.planks);
    this._wall('x', bx0, bx1, bzS, y, B.h, .25, P.planks, [{ c: B.x, w: 7, y0: 0, y1: 3.4 }]);
    this._gableRoof(B.x, B.z, B.w, B.d, y + B.h, 2.6, P.roofPlank, P.planks);
    for (const sx of [-3.6, 3.6]) this.addBox(.3, B.h, .3, B.x + sx, y + B.h / 2, bzS, P.planks);
    for (const [hx, hz, r] of [[22, -76, 0], [24.4, -76, .1], [23, -76, 0], [30, -70, .4], [30, -71.6, .3]]) { const hb = this.addBox(1.2, .8, 2.2, hx, y + .4 + (hx === 23 ? .8 : 0), hz, P.hay); hb.rotation.y = r; }
    // 낮은 돌담(농장 마당 남쪽, 농장 길 자리는 비움)
    this._wall('x', -33, -9.4, -54.5, y, 1.1, .6, P.stone); this._wall('x', -2.6, 30.5, -54.5, y, 1.1, .6, P.stone); this._wall('x', 37.5, 43, -54.5, y, 1.1, .6, P.stone);
    // 지휘소 안: 탁자(GLB)·무전기(GLB)·벽의 작전 지도·상자
    const cpx = (CP_ROOM.minX + CP_ROOM.maxX) / 2, cpz = (CP_ROOM.minZ + CP_ROOM.maxZ) / 2;
    const table = this.assets.instantiate('props.table', { fit: [1.8, .8, 1.0], fitMode: 'stretch' });
    if (table) { table.position.set(cpx, y + .08, cpz); this.scene.add(table); } else { this.addBox(1.8, .08, 1.0, cpx, y + .78, cpz, P.planks, { collide: false }); }
    const radio = this.assets.instantiate('props.radio', { fit: [.5, .35, .35] });
    if (radio) { radio.position.set(cpx - .45, y + .86, cpz - .1); radio.rotation.y = .4; this.scene.add(radio); } else this.addBox(.45, .3, .3, cpx - .45, y + 1.0, cpz, this.PM.gun, { collide: false, solid: false });
    const map = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshStandardMaterial({ map: this._mapTexture(), roughness: 1 })); map.position.set(cpx, y + 1.8, zN + T / 2 + .02); this.scene.add(map);
    for (const [px, pz] of [[CP_ROOM.minX + .7, zS - 1], [CP_ROOM.minX + .7, zS - 1.9]]) this.dropModel('props.crate', px, y, pz, [.9, .6, .7]);
    this.cpCenter = new V3(cpx, y, cpz);
  }
  /** 작전 지도(독일어 표기의 손그림 느낌) */
  _mapTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 352; const g = c.getContext('2d');
    g.fillStyle = '#d9cfae'; g.fillRect(0, 0, 512, 352); g.strokeStyle = 'rgba(80,90,60,.5)'; g.lineWidth = 1;
    for (let i = 0; i < 30; i++) { g.beginPath(); g.moveTo(rnd() * 512, rnd() * 352); for (let k = 0; k < 4; k++) g.lineTo(rnd() * 512, rnd() * 352); g.stroke(); }
    g.strokeStyle = '#7a3a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 300); g.bezierCurveTo(160, 220, 260, 260, 470, 90); g.stroke();
    g.fillStyle = '#2a2a2a'; g.font = 'bold 22px serif'; g.fillText('St-Lô', 380, 70); g.font = '16px serif'; g.fillText('Hecken — Abschnitt 3', 30, 34);
    g.strokeStyle = '#1f3a6a'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(120 + i * 70, 180 + Math.sin(i) * 30, 9, 0, 6.28); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  /** GLB 소품 하나(그림자·충돌 없이 겉모습만) */
  dropModel(key, x, y, z, fit, ry = 0) { const m = this.assets.instantiate(key, fit ? { fit } : {}); if (!m) return null; m.position.set(x, y, z); m.rotation.y = ry; this.scene.add(m); return m; }

  // ------------------------------------------------------------- 독일군 진지
  _military() {
    const P = this.P2, PM = this.PM;
    const bagGeo = this._modelGeometry('props.sandbag', (g) => { g.rotateY(Math.PI / 2); const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new V3()), c = b.getCenter(new V3()); g.translate(-c.x, -c.y, -c.z); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z); }) || new THREE.SphereGeometry(.5, 10, 7);
    const bags = [], ring = (cx, cz, r, a0, a1, rows) => { for (let k = 0; k < rows; k++) for (let a = a0; a <= a1; a += .62 / r) { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; bags.push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + .13 + k * .26, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0)), new V3(.74, .34, .62))); } };
    // MG42 진지: 출입구를 바라보는 반원 모래주머니 + MG42
    ring(MG_NEST.x, MG_NEST.z, 1.5, .25, Math.PI - .25, 3);
    this.addBox(3, .9, .4, MG_NEST.x, heightAt(MG_NEST.x, MG_NEST.z + 1.3) + .45, MG_NEST.z + 1.3, PM.dark, { solid: true }).visible = false;
    const mg = PB.mg42Geometry(), gy = heightAt(MG_NEST.x, MG_NEST.z) + .95;
    for (const [geo, mat] of [[mg.steel, PM.gun], [mg.wood, PM.wood]]) { const m = new THREE.Mesh(geo, mat); m.position.set(MG_NEST.x, gy, MG_NEST.z + .6); this.scene.add(m); }
    // 박격포 진지: 구덩이 둘레 모래주머니 + 81mm 박격포 + 탄약 상자
    ring(MORTAR.x, MORTAR.z, 3.4, 0, Math.PI * 2 - .7, 2);
    this.mortarGroup = this._mortarModel(); this.mortarGroup.position.set(MORTAR.x, heightAt(MORTAR.x, MORTAR.z), MORTAR.z); this.scene.add(this.mortarGroup);
    for (const [dx, dz] of [[1.6, .8], [1.9, -.3]]) this.dropModel('decor.ammobox', MORTAR.x + dx, heightAt(MORTAR.x + dx, MORTAR.z + dz), MORTAR.z + dz);
    // 방어선 뒤 참호 판자벽 + 방어선 앞 철조망
    for (let x = TRENCH.minX; x < TRENCH.maxX; x += 20) { const len = Math.min(20, TRENCH.maxX - x) - .5, g = PB.trenchRevetment(len); g.scale(1, .6, 1); const m = new THREE.Mesh(g, PM.wood); const cx = x + len / 2; m.position.set(cx, heightAt(cx, (TRENCH.minZ + TRENCH.maxZ) / 2) - .02, (TRENCH.minZ + TRENCH.maxZ) / 2); this.scene.add(m); }
    for (const [a, b] of [[-66, -24], [-8, 26], [38, 66]]) { const w = PB.barbedWire(new V3(a, 0, -6.5), new V3(b, 0, -6.5), heightAt); const m1 = new THREE.Mesh(w.wire, PM.wire), m2 = new THREE.Mesh(w.posts, PM.wood); m1.userData.noShadow = true; this.scene.add(m1, m2); }
    // 저격 망루: 나무에 걸친 발판 + 사다리 + 난간
    const sy = heightAt(SNIPER.x, SNIPER.z) + SNIPER.y; this.sniperFloor = sy;
    this.addBox(2, .14, 2, SNIPER.x, sy - .07, SNIPER.z, P.planks, { collide: false });
    for (const [rx, rz, w, d] of [[0, 1, 2, .08], [-1, 0, .08, 2], [1, 0, .08, 2]]) this.addBox(w, .9, d, SNIPER.x + rx, sy + .45, SNIPER.z + rz, P.planks, { collide: false, solid: rz !== 1 });
    for (let k = 0; k < 12; k++) this.addBox(.7, .06, .08, SNIPER.x, heightAt(SNIPER.x, SNIPER.z + 1.4) + .5 * k + .3, SNIPER.z + 1.4 + k * .02, P.planks, { collide: false, solid: false });
    for (const sx of [-.32, .32]) { const rail = new THREE.Mesh(this.boxGeo(.08, SNIPER.y + .3, .08), P.planks); rail.position.set(SNIPER.x + sx, heightAt(SNIPER.x, SNIPER.z) + (SNIPER.y + .3) / 2, SNIPER.z + 1.5); this.scene.add(rail); }
    const im = new THREE.InstancedMesh(bagGeo, this.M.bag, bags.length); bags.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; im.userData.keepShadow = true; this.scene.add(im);
  }
  /** 81mm 박격포(Granatwerfer 34): 포신 + 받침판 + 양각대 */
  _mortarModel() {
    const g = new THREE.Group(), steel = this.PM.gun;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(.05, .055, 1.15, 12), steel); tube.position.set(0, .55, 0); tube.rotation.x = -.75; g.add(tube);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(.32, .36, .06, 14), steel); plate.position.set(0, .05, .28); g.add(plate);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .8, 6), steel); leg.position.set(s * .17, .36, -.22); leg.rotation.set(.35, 0, s * .3); g.add(leg); }
    g.userData.tube = tube; return g;
  }
  /** 박격포가 부서진 모습: 포신이 넘어지고 그을림 */
  breakMortar() { const t = this.mortarGroup && this.mortarGroup.userData.tube; if (!t) return; t.rotation.set(-1.5, 0, .6); t.position.y = .12; t.updateMatrix(); this.mortarGroup.updateMatrixWorld(true); }

  // ------------------------------------------------------------- 소품
  _props2() {
    const P = this.P2;
    // 불타는 건초 더미(연기는 게임 루프가 smokeSources 에서 낸다)
    const hs = new THREE.Mesh(PB.mound(2.2, 1.6, 2.6, 4), P.hayBurnt); hs.position.set(HAYSTACK_FIRE.x, heightAt(HAYSTACK_FIRE.x, HAYSTACK_FIRE.z) - .1, HAYSTACK_FIRE.z); this.scene.add(hs);
    // 온전한 건초 더미 몇 개(들판의 엄폐물)
    for (const [x, z] of [[-14, 40], [26, 36], [-48, -28], [58, -36]]) { const m = new THREE.Mesh(PB.mound(1.9, 1.5, 2.3, x), P.hay); m.position.set(x, heightAt(x, z) - .1, z); this.scene.add(m); colliders.push({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.9, maxZ: z + 1.9, minY: heightAt(x, z) - 1, maxY: heightAt(x, z) + 1.4 }); const sb = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 3.6), this.PM.dark); sb.position.set(x, heightAt(x, z) + .7, z); sb.visible = false; sb.userData.surface = 'sand'; this.scene.add(sb); solids.push(sb); }
    // 출입구의 나무 울타리 문(열린 채로)과 문기둥
    for (const h of HEDGES) for (const [c, w] of h.gaps || []) {
      const along = h.a[0] === h.b[0] ? 1 : 0, fixed = h.a[1 - along];
      for (const s of [-1, 1]) { const sc = c + s * (w / 2 + .1), [x, z] = along ? [fixed, sc] : [sc, fixed]; this.addBox(.22, 1.5, .22, x, heightAt(x, z) + .75, z, P.planks, { collide: false, solid: false }); }
      const gx = along ? fixed + 1.6 : c - w / 2 + .2, gz = along ? c - w / 2 + .2 : fixed + 1.6, gate = new THREE.Group();
      for (let k = 0; k < 4; k++) { const bar = new THREE.Mesh(this.boxGeo(2.4, .1, .06), P.planks); bar.position.set(1.2, .3 + k * .3, 0); gate.add(bar); }
      gate.position.set(gx, heightAt(gx, gz), gz); gate.rotation.y = along ? -1.2 : 1.9; this.scene.add(gate);
    }
    // 수레·통·상자(농가 마당)
    this.dropModel('decor.barrel', -2, FARM_H, -64); this.dropModel('decor.barrel', -1.2, FARM_H, -64.8); this.dropModel('decor.crate', 6, FARM_H, -60, null, .5); this.dropModel('decor.jerrycan', 8, FARM_H, -61.5);
    const cart = new THREE.Group(); const bed = new THREE.Mesh(this.boxGeo(2.6, .12, 1.4), P.planks); bed.position.y = .75; cart.add(bed);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(this.boxGeo(2.6, .4, .06), P.planks); side.position.set(0, .98, s * .67); cart.add(side); const wheel = new THREE.Mesh(new THREE.TorusGeometry(.5, .06, 6, 14), P.planks); wheel.position.set(0, .5, s * .78); cart.add(wheel); }
    const shaft = new THREE.Mesh(this.boxGeo(2.2, .08, .08), P.planks); shaft.position.set(2.2, .55, 0); cart.add(shaft);
    cart.position.set(10, FARM_H, -64); cart.rotation.y = .6; this.scene.add(cart); this.addBox(3.2, 1.3, 1.8, 10, FARM_H + .65, -64, this.PM.dark).visible = false;
  }

  // ------------------------------------------------------------- 풀
  _groundCover2() {
    const a = new THREE.PlaneGeometry(1, 1); a.translate(0, .5, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const geo = mergeStrips([a, b]);
    const N = 14000, im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.tex.grass, alphaTest: .45, side: THREE.DoubleSide }), N), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const x = rr(-73, 73), z = rr(-95, 103);
      if (z > 56 && Math.abs(x) < 5) continue; if (z < -52 && x > -34 && x < 44) continue;   // 농로·농장 마당
      const w = rr(.35, .8), h = rr(.2, .5); e.set(0, rr(0, 3.14), 0); q.setFromEuler(e);
      m.compose(new V3(x, heightAt(x, z) - .03, z), q, new V3(w, h, w)); im.setMatrixAt(k, m);
      const v = rr(.7, 1.2); c.setRGB(.17 * v, .21 * v, .08 * v); im.setColorAt(k, c); k++;
    }
    im.count = k; im.userData.noShadow = true; this.scene.add(im);
    // 나무 줄기(인스턴싱): 가까이는 그림자
    if (this._trunks) this.lods.push(new InstanceLOD(this.scene, [{ geometry: new THREE.CylinderGeometry(.75, 1, 1, 9), material: this.P2.bark, low: new THREE.CylinderGeometry(.75, 1, 1, 5) }], this._trunks, { near: 50, lowShadow: false }));
  }
}

/** 면이 이어진 여러 지오메트리를 하나로(같은 속성: position·normal·uv) */
function mergeStrips(list) {
  let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni); let o = 0, oi = 0;
  for (const g of list) { const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + o; oi += g.index.count; } else { for (let i = 0; i < c; i++) idx[oi + i] = o + i; oi += c; } o += c; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); return out;
}
/** 다면체를 흔들어 덤불 덩어리처럼: 정점을 합친 뒤 반지름을 무작위로 바꾸고, 부드러운 노멀과 상자 투영 UV(늘어짐 없음)를 만든다 */
function jitter(g, k) {
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const f = 1 + (rnd() * 2 - 1) * k, x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * f, y * f * .85, z * f); }
  g = g.toNonIndexed(); PB.boxUV(g, .9); g.computeVertexNormals();
  // 상자 투영 UV 를 위해 면 노멀로 바꿨으니, 덤불처럼 둥글게 보이도록 노멀을 중심 방향과 섞는다
  const n = g.attributes.normal, q = g.attributes.position;
  for (let i = 0; i < n.count; i++) { const cx = q.getX(i), cy = q.getY(i), cz = q.getZ(i), l = Math.hypot(cx, cy, cz) || 1, mx = n.getX(i) * .35 + cx / l * .65, my = n.getY(i) * .35 + cy / l * .65, mz = n.getZ(i) * .35 + cz / l * .65, ml = Math.hypot(mx, my, mz); n.setXYZ(i, mx / ml, my / ml, mz / ml); }
  return g;
}
