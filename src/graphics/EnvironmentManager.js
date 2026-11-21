// EnvironmentManager — 지형, 풀, 하늘, 바다, 해변 소품(상륙정·전차·체코 고슴도치·방파제·사대·벙커·상자), 보급품 모양.
//
// 소품을 만들면서 world.solids(사격 판정)와 world.colliders(이동 충돌)를 채운다.
// GLB 슬롯(props.*, pickups.*)에 모델이 있으면 같은 자리에 모델을 놓고 절차적 메시는 숨긴다.
// 이때도 충돌·사격 판정은 원래 절차적 형태를 그대로 쓰므로 게임플레이가 바뀌지 않는다.
import * as THREE from 'three';
import { V3, sr, srand, clamp, unitBox } from '../core/utils.js';
import { heightAt, baseH, solids, colliders, craters } from '../game/world.js';
import { createTerrainMaterial } from './TerrainMaterial.js';
import * as PB from './PropBuilder.js';
import { InstanceLOD, partsOf, pillowLOD, mergedClone } from './InstanceLOD.js';

const NOISE_GLSL = `float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash2(i), hash2(i + vec2(1., 0.)), f.x), mix(hash2(i + vec2(0., 1.)), hash2(i + vec2(1., 1.)), f.x), f.y); }
  float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.; a *= .5; } return s; }`;

export class EnvironmentManager {
  /**
   * @param {{renderer: import('./Renderer.js').Renderer, lighting: import('./LightingManager.js').LightingManager,
   *          assets: import('./AssetManager.js').AssetManager, materials: object, textures: object}} deps
   */
  constructor({ renderer, lighting, assets, materials, textures }) {
    Object.assign(this, { renderer, lighting, assets, M: materials.M, tex: textures });
    this.scene = renderer.scene;
    /** 불타는 전차 위치 — 연기 기둥 효과를 여기서 낸다. */
    this.smokeSources = [[13, 36], [-27, 18]];
    this.dressed = {};   // 슬롯 키 → GLB 로 대체된 개수 (보고용)
    renderer.onQuality.push((q) => this.setQuality(q));
  }

  /** 전장을 만든다. 고정 시드 난수를 쓰므로 호출 순서를 바꾸지 말 것. */
  build() {
    this._terrain();
    this._skyAndWater();
    this._props();
    // 정적 소품은 모두 그림자를 드리우고 받는다
    const lodMeshes = new Set(); for (const l of this.lods) for (const L of l.levels) for (const im of [L.near, L.mid, L.far]) if (im) lodMeshes.add(im);
    // 숨긴 충돌 상자는 그릴 일이 없으므로 그림자 계산에서도 뺀다. 거리별 인스턴싱 메시는 자기 설정을 유지
    this.scene.traverse((o) => { if (o.isMesh && !lodMeshes.has(o) && o !== this.terrain && o !== this.grassLayer && o !== this.water && o !== this.sky) { o.castShadow = o.visible; o.receiveShadow = true; } });
    this._groundCover();
    // 7단계: 움직이지 않는 장면 물체는 매 프레임 행렬 계산을 건너뛴다
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => { if (o !== this.scene && o !== this.sky && o !== this.water && !o.isLight && o !== this.lighting.sun.target) { o.matrixAutoUpdate = false; } });
    for (const l of this.lods) l.update(new V3(0, 2, 70), true);
  }

  // ------------------------------------------------------------- 지형
  /** 층 가중치(젖은 모래·자갈·진흙·풀·그을림)를 정점마다 계산해 6층 블렌딩 재질에 넘긴다. 높이 자체는 world.heightAt 그대로 */
  _terrain() {
    const g = new THREE.PlaneGeometry(300, 290, 200, 290); g.rotateX(-Math.PI / 2); g.translate(0, 0, -40);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sa = new Float32Array(n * 4), sb = new Float32Array(n * 2);
    const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const noise = (x, z) => Math.sin(x * .7 + z * .3) * .5 + Math.sin(x * .23 - z * .51 + 2.) * .5;
    const noise2 = (x, z) => Math.sin(x * 1.9 + Math.sin(z * .8) * 2) * .5 + Math.sin(z * 1.3 - x * .4) * .5;
    // 참호·벙커 위치(진흙): 능선 사대 구간과 같은 좌표
    const trench = [[-30, -22], [-18, -8], [8, 18], [22, 30], [-58, -44], [44, 58]], bunkers = [-36, 0, 36];
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
      const nz = noise(x, z), nz2 = noise2(x, z);
      let wet = ss(62.5, 70, z + nz * 1.5), gravel = 0, mud = 0, grass = 0, burn = 0;
      if (h < baseH(z) - .3) wet = Math.max(wet, .75);                                       // 분화구 바닥의 물웅덩이
      gravel = ss(-4.5, -2.6, z) * (1 - ss(4, 10, z + nz * 2)) * clamp(.55 + nz2 * .6, 0, 1);   // 방파제 앞 자갈 둑
      if (z > -32 && z < -7) { mud = clamp(.35 + nz * .35, 0, .8); gravel = Math.max(gravel, clamp(nz2 - .45, 0, .6)); }  // 절벽 경사
      grass = clamp((-5.5 - z) / 9 + nz * .45, 0, 1) * (1 - mud * .6);
      for (const [a, b] of trench) if (x > a - 1.5 && x < b + 1.5 && z < -35.6 && z > -38.6) { mud = Math.max(mud, .9); grass *= .1; }
      for (const bx of bunkers) { const d = Math.hypot(x - bx, z + 39); if (d < 7.5) { const k = 1 - d / 7.5; mud = Math.max(mud, k * .9); grass *= 1 - k; } }
      for (const c of craters) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r * 1.4) { burn = Math.max(burn, clamp(1 - d / (c.r * 1.1), 0, 1) * .85); mud = Math.max(mud, clamp(1 - d / (c.r * .6), 0, 1) * .6); } }
      // 합이 1 을 넘지 않게 (나머지는 마른 모래)
      let sum = wet + gravel + mud + grass + burn; if (sum > 1) { wet /= sum; gravel /= sum; mud /= sum; grass /= sum; burn /= sum; }
      sa[i * 4] = wet; sa[i * 4 + 1] = gravel; sa[i * 4 + 2] = mud; sa[i * 4 + 3] = grass; sb[i * 2] = burn;
      const j = .92 + Math.random() * .12 - burn * .25; col[i * 3] = j; col[i * 3 + 1] = j; col[i * 3 + 2] = j * .98;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2));
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, createTerrainMaterial(this.assets));
    this.terrain.receiveShadow = true; this.scene.add(this.terrain);
    this.grassLayer = null;
  }

  // ------------------------------------------------------------- 하늘 / 바다
  _skyAndWater() {
    const L = this.lighting, fogCol = L.fogColor, SUN_DIR = L.sunDir;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(395, 32, 20), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { t: { value: 0 }, sunDir: { value: SUN_DIR }, horizon: { value: fogCol } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform float t; uniform vec3 sunDir, horizon; varying vec3 vDir; ${NOISE_GLSL}
        void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.);
          vec3 col = mix(horizon, vec3(.2, .24, .3), pow(h, .55));
          vec2 uv = d.xz / (d.y + .22) * 1.5 + vec2(t * .012, t * .005);
          float c = fbm(uv), c2 = fbm(uv * 2.7 - 5.);
          float sd = max(dot(d, sunDir), 0.);
          vec3 lit = mix(vec3(.62, .63, .64), vec3(1.25, .98, .74), pow(sd, 3.));
          col = mix(col, vec3(.13, .145, .17), smoothstep(.38, .78, c) * .85);
          col = mix(col, lit, smoothstep(.5, .15, c) * (.35 + .4 * c2));
          col += vec3(1.5, 1.05, .6) * (pow(sd, 10.) * .35 + pow(sd, 90.) * 1.3) * (1. - smoothstep(.45, .8, c) * .8);
          col = mix(horizon, col, smoothstep(-.01, .16, d.y));
          gl_FragColor = vec4(col, 1.); }` }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; this.scene.add(this.sky);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(700, 360, 1, 1), new THREE.ShaderMaterial({ transparent: true, uniforms: { t: { value: 0 }, sunDir: { value: SUN_DIR }, fogColor: { value: fogCol }, skyCol: { value: new THREE.Color(.27, .33, .38) }, fogDensity: { value: this.scene.fog.density } },
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, fogDensity; uniform vec3 sunDir, fogColor, skyCol; varying vec3 wp; ${NOISE_GLSL}
        float wh(vec2 p){ return sin(p.y * .33 + t * 1.1 + sin(p.x * .12) * 1.5) * .55 + sin(p.x * .21 - t * .7 + p.y * .11) * .3 + (vnoise(p * .9 + t * .5) - .5) * .5 + (vnoise(p * 2.6 - t * .8) - .5) * .22; }
        void main(){ vec2 p = wp.xz; float e = .35;
          float dcam = length(cameraPosition - wp);
          vec3 n = normalize(vec3(wh(p) - wh(p + vec2(e, 0.)), .9 + dcam * .03, wh(p) - wh(p + vec2(0., e))));
          vec3 V = normalize(cameraPosition - wp); float fres = pow(1. - max(dot(n, V), 0.), 4.);
          vec3 col = mix(skyCol * vec3(.07, .13, .16), skyCol, clamp(fres * .8 + .03, 0., 1.));
          col += vec3(1.6, 1.25, .85) * pow(max(dot(reflect(-V, n), sunDir), 0.), 90.) * .9;
          float sz = p.y + sin(p.x * .21 + t * .6) * 1.6; float shore = smoothstep(86., 75., sz) * smoothstep(69., 73., sz);
          float foam = shore * (smoothstep(.6, .82, vnoise(vec2(p.x * .8, p.y * 1.7 + t * 1.3))) * .75 + smoothstep(.93, 1., sin(p.y * 1.25 + t * 1.7 + sin(p.x * .3) * 2.2)) * .6);
          // 해안으로 밀려 올라오는 파도 머리(흰 거품 줄)
          float runup = shore * smoothstep(.9, 1., sin(sz * .55 - t * 1.25 + sin(p.x * .17) * 1.4)) * (.6 + .4 * vnoise(p * .9 + t));
          foam += runup;
          col = mix(col, skyCol * 1.5 + .12, clamp(foam, 0., 1.) * .75);
          float d = dcam, f = 1. - exp(-fogDensity * fogDensity * d * d);
          gl_FragColor = vec4(mix(col, fogColor, f), mix(.93, .7, shore * (1. - foam))); }` }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.set(0, 0, 240); this.scene.add(this.water);
  }
  /** HDR 하늘이 적용되면 절차적 하늘을 내리고 바다 반사색을 맞춘다. */
  useHdriSky() { this.scene.remove(this.sky); this.water.material.uniforms.skyCol.value.copy(this.lighting.fogColor).multiplyScalar(.8); }

  // ------------------------------------------------------------- 소품
  boxGeo(w, h, d, tile = .5) { // 실제 크기에 맞춰 텍스처 밀도가 일정한 상자
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] * tile, uv.getY(k) * dims[f][1] * tile); }
    return g;
  }
  /** 상자 하나 추가. solid=false 면 사격 판정 제외, collide=false 면 이동 충돌 제외. */
  addBox(w, h, d, x, y, z, mat, o = {}) {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat); m.position.set(x, y, z);
    (o.parent || this.scene).add(m);
    if (o.solid !== false) solids.push(m);
    if (o.collide !== false && !o.parent) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y - h / 2, maxY: y + h / 2 });
    return m;
  }
  /**
   * GLB 슬롯 모델로 겉모습을 바꾼다. hide 의 메시는 숨기기만 한다(사격·충돌 판정은 그대로).
   * @returns {THREE.Object3D|null} 붙인 모델 (슬롯이 비었으면 null)
   */
  dress(key, parent, hide, fit, pos = [0, 0, 0], rotY = 0) {
    const inst = this.assets.instantiate(key, { fit });
    if (!inst) return null;
    for (const m of hide) m.visible = false;
    inst.position.set(...pos); inst.rotation.y = rotY; parent.add(inst);
    this.dressed[key] = (this.dressed[key] || 0) + 1;
    return inst;
  }

  /** 4단계 재질: 콘크리트·녹슨 강철·나무·진흙 둔덕·전차 잔해 등 (실사 PBR 텍스처) */
  _materials() {
    const a = this.assets, S = (o) => new THREE.MeshStandardMaterial(o);
    return this.PM = {
      concrete: S({ color: 0xcfcac0, ...a.pbr('cracked_concrete_wall', .5, .5) }),
      earth: S({ color: 0xb0a890, ...a.pbr('brown_mud', .45, .45) }),
      mound: S({ color: new THREE.Color(0xc8a878).multiplyScalar(1.5), ...a.pbr('brown_mud', .8, .8) }),   // 진흙 텍스처가 어두워 밝게 보정
      sod: S({ color: 0x9aa070, ...a.pbr('sparse_grass', .35, .35) }),
      rust: S({ color: 0x8a6a58, metalness: .45, ...a.pbr('rusty_metal_02', 1.5, 1.5) }),
      wire: S({ color: 0x3a3330, metalness: .6, roughness: .55 }),
      wood: S({ color: 0x9a8468, ...a.pbr('weathered_planks', .8, .8) }),
      ply: S({ color: new THREE.Color(0x9aa4aa).multiplyScalar(3), ...a.pbr('weathered_planks', .6, .6) }),             // 회색 도장 합판
      boatSteel: S({ color: new THREE.Color(0x7d878c).multiplyScalar(1.8), metalness: .5, ...a.pbr('metal_plate', .5, .5) }),
      tank: S({ color: new THREE.Color(0x6d6f58).multiplyScalar(2.4), metalness: .35, ...a.pbr('green_metal_rust', .6, .6) }),   // 그을린 올리브
      burnt: S({ color: new THREE.Color(0x3a3632).multiplyScalar(2), metalness: .4, ...a.pbr('rusty_metal_02', .6, .6) }),
      dark: new THREE.MeshBasicMaterial({ color: 0x050505 }),
      gun: S({ color: 0x2a2b2c, metalness: .8, roughness: .45 }),
    };
  }

  _props() {
    const M = this.M, scene = this.scene, PM = this._materials(); this.gfxSwap = []; this.lods = [];
    const hide = (...ms) => { for (const m of ms) m.visible = false; };   // 판정은 남기고 보이지만 않게
    const place = (geo, mat, x, y, z, ry = 0, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = shadow; m.receiveShadow = true; m.userData.visualOnly = true; scene.add(m); return m; };
    const bagMats = [], hogMats = [];
    const sandbagWall = (xc, z, len, rows = 4) => {
      const y0 = Math.min(heightAt(xc - len / 2, z), heightAt(xc + len / 2, z), heightAt(xc, z)) - 0.1, H = rows * 0.26;
      hide(this.addBox(len - 0.5, H + 0.2, 0.34, xc, y0 + H / 2 - 0.2, z, M.bag));
      const n = Math.round(len / 0.62);
      for (let r = 0; r < rows; r++) for (let i = 0; i < n + (r % 2); i++) {
        const m = new THREE.Matrix4(); const x = xc - len / 2 + (i + 0.5 - (r % 2) * 0.5) * (len / n);
        m.compose(new V3(clamp(x, xc - len / 2 + .2, xc + len / 2 - .2), y0 + 0.13 + r * 0.26, z + sr(-.03, .03)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sr(-.08, .08), sr(-.04, .04))), new V3(0.74, 0.34, 0.62));
        bagMats.push(m);
      }
    };
    const bunker = (bx, bz) => {
      const y = 13, T = 0.6, W = 8, D = 6, H = 2.8, s0 = 1.05, s1 = 1.75, fz = bz + D / 2 - T / 2;
      const parts = [
        this.addBox(W, s0 + 1, T, bx, y + s0 / 2 - 0.5, fz, M.concrete, { collide: false }),
        this.addBox(W, H - s1, T, bx, y + (H + s1) / 2, fz, M.concrete, { collide: false }),
        this.addBox(2, s1 - s0, T, bx - 3, y + (s0 + s1) / 2, fz, M.concrete, { collide: false }),
        this.addBox(2, s1 - s0, T, bx + 3, y + (s0 + s1) / 2, fz, M.concrete, { collide: false }),
      ];
      colliders.push({ minX: bx - W / 2, maxX: bx + W / 2, minZ: fz - T / 2, maxZ: fz + T / 2, minY: y - 1, maxY: y + H });
      parts.push(this.addBox(T, H + 1, D, bx - W / 2 + T / 2, y + H / 2 - 0.5, bz, M.concrete), this.addBox(T, H + 1, D, bx + W / 2 - T / 2, y + H / 2 - 0.5, bz, M.concrete),
        this.addBox(3.2, H + 1, T, bx - 2.4, y + H / 2 - 0.5, bz - D / 2 + T / 2, M.concrete), this.addBox(3.2, H + 1, T, bx + 2.4, y + H / 2 - 0.5, bz - D / 2 + T / 2, M.concrete),
        this.addBox(W + 0.8, 0.55, D + 0.8, bx, y + H + 0.27, bz, M.concreteDark, { collide: false }),
        this.addBox(W - 1.2, 0.05, D - 1.2, bx, y + 0.03, bz, M.concreteDark, { collide: false, solid: false }),
        this.addBox(0.07, 0.07, 1.1, bx, y + 1.38, fz + 0.2, M.gun, { collide: false, solid: false }),
        this.addBox(0.5, 0.3, 0.4, bx, y + 0.9, fz - 0.6, M.crate, { collide: false, solid: false }));
      hide(...parts);
      // 새 모양: 경사 지붕·차양·계단형 총안구, 흙 둔덕, 안쪽 어둠, MG42
      const bp = PB.bunkerParts(W, D, H, [s0, s1]);
      place(bp.concrete, PM.concrete, bx, y, bz); place(bp.earth, PM.mound, bx, y, bz);
      { // 안쪽: 기존은 검은 상자, 5단계는 어두운 콘크리트 실내 + 천장 전등의 희미한 주황빛(점광원 없이 재질에서 계산)
        const inner = place(bp.dark, PM.dark, bx, y, bz, 0, false);
        const lamp = new THREE.Vector3(bx, y + H - .45, bz - D / 2 + 1.3);
        const im = this._bunkerInterior(lamp); inner.userData.gfx = { legacy: PM.dark, high: im };
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .62, .3).multiplyScalar(5) }));
        bulb.position.copy(lamp); bulb.userData.gfxOnly = true; scene.add(bulb); this.gfxSwap.push(inner, bulb);
      }
      const mg = PB.mg42Geometry(); place(mg.steel, PM.gun, bx, y + 1.3, fz + .05); place(mg.wood, PM.wood, bx, y + 1.3, fz + .05);
    };
    const hedgehog = (x, z) => {
      const g = new THREE.Group(); g.position.set(x, heightAt(x, z) + 0.75, z); g.rotation.y = sr(0, 3);
      const bars = [];
      for (const d of [[1, 1, 0.9], [-1, 1, 0.7], [0.1, 1, -1.2]]) {
        const b = new THREE.Mesh(unitBox, M.rust); b.scale.set(0.16, 2.3, 0.16);
        b.quaternion.setFromUnitVectors(new V3(0, 1, 0), new V3(...d).normalize()); g.add(b); solids.push(b); bars.push(b);
      }
      scene.add(g);
      colliders.push({ minX: x - .55, maxX: x + .55, minZ: z - .55, maxZ: z + .55, minY: -5, maxY: g.position.y + 0.7 });
      if (!this.dress('props.hedgehog', g, bars, [1.9, 1.6, 1.9], [0, -0.75, 0])) { hide(...bars); hogMats.push(new THREE.Matrix4().compose(new V3(x, g.position.y - .12, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.rotation.y, 0)), new V3(1, 1, 1))); }
    };
    const boat = (x, z) => {
      const y = -0.25, parts = [
        this.addBox(3.6, 0.2, 10, x, y, z + 5, M.boat, { collide: false }),
        this.addBox(0.25, 1.9, 10, x - 1.8, y + 0.95, z + 5, M.boat),
        this.addBox(0.25, 1.9, 10, x + 1.8, y + 0.95, z + 5, M.boat),
        this.addBox(3.6, 2.4, 0.3, x, y + 1.2, z + 10, M.boat),
        this.addBox(3.6, 1.6, 2.2, x, y + 0.8, z + 8.8, M.boat),
      ];
      const r = this.addBox(3.5, 0.18, 2.8, x, y - 0.2, z - 1.3, M.boat, { collide: false }); r.rotation.x = -0.16; parts.push(r);
      if (!this.dress('props.boat', scene, parts, [3.7, 2.5, 12.6], [x, y - 0.35, z + 3.9])) { hide(...parts); const h = PB.higginsParts(); place(h.ply, PM.ply, x, y - .1, z); place(h.steel, PM.boatSteel, x, y - .1, z); }
    };
    const tank = (x, z) => {
      const y = heightAt(x, z) - 0.1, parts = [this.addBox(3, 1.2, 5.8, x, y + 0.8, z, M.tank), this.addBox(3.4, 0.7, 6, x, y + 0.35, z, M.steel, { collide: false })];
      const t = this.addBox(2, 0.75, 2.2, x + 0.1, y + 1.75, z - 0.4, M.tank, { collide: false }); t.rotation.y = 0.5;
      const b = this.addBox(0.14, 0.14, 2.6, x - 0.75, y + 1.72, z - 2.2, M.steel, { collide: false }); b.rotation.set(0.12, 0.5, 0);
      parts.push(t, b);
      if (!this.dress('props.tank', scene, parts, [3.4, 2.4, 7.4], [x, y, z])) { hide(...parts); const s = PB.shermanParts(), ry = (x * 7 % 1) * .3 - .15; place(s.hull, PM.tank, x, y - .1, z, ry); place(s.track, PM.burnt, x, y - .1, z, ry); place(s.wheel, PM.burnt, x, y - .1, z, ry); }
    };
    // 7단계: 상자 GLB 도 하나씩 넣지 않고 거리별 인스턴싱으로 그린다(크기가 제각각이라 변환 행렬에 배율이 들어간다)
    const crates = { parts: null, items: [] };
    const crate = (w, h, d, x, y, z) => { const m = this.addBox(w, h, d, x, y, z, M.crate); const inst = this.assets.instantiate('props.crate', { fit: [w, h, d] }); if (!inst) return;
      m.visible = false; inst.position.set(x, y - h / 2, z); inst.updateMatrixWorld(true); if (!crates.parts) crates.parts = partsOf(inst); crates.items.push(inst.matrixWorld.clone()); this.dressed['props.crate'] = (this.dressed['props.crate'] || 0) + 1; };

    boat(0, 82); boat(-34, 80); boat(31, 81); boat(58, 83); boat(-60, 84);
    tank(13, 36); tank(-27, 18);
    for (let i = 0; i < 46; i++) { const x = sr(-64, 64), z = sr(8, 68); if (Math.abs(x) < 3 && z > 60) continue; if (Math.abs(x - 13) < 4 && Math.abs(z - 36) < 5) continue; if (Math.abs(x + 27) < 4 && Math.abs(z - 18) < 5) continue; hedgehog(x, z); }
    // 방파제: 판정 상자는 그대로, 보이는 것은 파도막이 곡면 단면
    const walls = [[-68, -40], [-34, -12], [-6, 10], [16, 38], [44, 68]];
    for (const [a, b] of walls) { const xc = (a + b) / 2, gy = heightAt(xc, -3); hide(this.addBox(b - a, 2.6, 0.7, xc, gy + 0.25, -3, M.concrete)); place(PB.seawallGeometry(b - a), PM.concrete, xc, gy - 1.05, -3); }
    // 능선 참호의 사대
    const crest = [[-30, -22], [-18, -8], [8, 18], [22, 30], [-58, -44], [44, 58]];
    for (const [a, b] of crest) sandbagWall((a + b) / 2, -35.4, b - a);
    // 절벽 중턱 전진 진지
    for (const x of [-25, 13, 42]) sandbagWall(x, -12.6, 4.2);
    // 후방 엄폐
    sandbagWall(-18, -52, 5); sandbagWall(18, -52, 5); sandbagWall(0, -62, 6); sandbagWall(-40, -58, 4); sandbagWall(40, -58, 4);
    bunker(-36, -39); bunker(0, -39); bunker(36, -39);
    for (const [x, z] of [[-9, -48], [10, -49], [-28, -66], [27, -65], [3, -74]]) { crate(1.3, 1.0, 1.3, x, 13.5, z); crate(0.9, 0.8, 0.9, x + 1.2, 13.4, z + .2); }
    if (crates.parts) this.lods.push(new InstanceLOD(scene, crates.parts, crates.items, { near: 45, far: 150 }));
    { // 모래주머니: 실제 스캔한 포대 모양(없으면 둥근 덩어리)
      const bagGeo = this._modelGeometry('props.sandbag', (g) => { g.rotateY(Math.PI / 2); const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new V3()), c = b.getCenter(new V3()); g.translate(-c.x, -c.y, -c.z); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z); });
      // 7단계: 18m 안은 스캔 모양(844 삼각형), 밖은 같은 크기의 납작한 베개 모양(약 90 삼각형)
      const geo = bagGeo || new THREE.SphereGeometry(.5, 10, 7), fix = bagGeo ? new THREE.Matrix4().makeScale(1.0, 1.05, 1.0) : new THREE.Matrix4();
      const colors = bagMats.map(() => { const v = sr(.8, 1.12); return new THREE.Color(v, v * sr(.96, 1), v * sr(.88, .98)); });
      this.lods.push(new InstanceLOD(scene, [{ geometry: geo, material: M.bag, low: bagGeo ? pillowLOD(geo) : null }], bagMats.map((m) => m.clone().multiply(fix)), { near: 18, lowShadow: true, colors }));
    }
    if (hogMats.length) { const im = new THREE.InstancedMesh(PB.hedgehogGeometry(), PM.rust, hogMats.length); hogMats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; scene.add(im); }
    this._dressing(walls, crest, place, PM);
  }

  /** 슬롯 모델의 첫 메시 지오메트리(노드 변환 반영). 인스턴싱용 */
  _modelGeometry(key, fix) {
    const inst = this.assets.instantiate(key); if (!inst) return null;
    inst.updateMatrixWorld(true); let geo = null;
    inst.traverse((o) => { if (!geo && o.isMesh) { geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); } });
    if (geo && fix) fix(geo); return geo;
  }

  /** 철조망·참호 판자벽·흩어진 장비(고정 시드 별도 난수 — 기존 배치에 영향 없음). 모두 충돌 없음 */
  _dressing(walls, crest, place, PM) {
    let seed = 6061944; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }, rr = (a, b) => a + rnd() * (b - a);
    const wire = (ax, az, bx, bz) => { const w = PB.barbedWire(new V3(ax, 0, az), new V3(bx, 0, bz), heightAt); place(w.wire, PM.wire, 0, 0, 0, 0, false); place(w.posts, PM.wood, 0, 0, 0); };
    // 방파제 앞(벽 구간만 — 틈은 비워 둔다), 능선 사대 앞, 해변 중간 두 줄(돌파 지점은 끊음)
    for (const [a, b] of walls) wire(Math.max(a, -66) + 1, -.6, Math.min(b, 66) - 1, -.6);
    for (const [a, b] of crest) wire(a + .5, -33.4, b - .5, -33.4);
    for (const z of [44, 26]) for (let x = -62; x < 60; x += 14) if (rnd() < .7) wire(x, z + rr(-1.5, 1.5), x + rr(6, 10), z + rr(-1.5, 1.5));
    // 참호: 사대 뒤 판자벽·발판 (얕은 개인호)
    for (const [a, b] of crest) { const g = PB.trenchRevetment(b - a); g.scale(1, .55, 1); place(g, PM.wood, (a + b) / 2, heightAt((a + b) / 2, -37.2) - .05, -37.2); }
    // 흩어진 장비·잔해 (Poly Haven 스캔 모델)
    const decor = ['decor.jerrycan', 'decor.barrel', 'decor.tyre', 'decor.wheel', 'decor.crate', 'decor.ammobox'];
    // 7단계: 장면에 모델을 하나씩 넣지 않고 종류별로 위치만 모아 거리별 인스턴싱(InstanceLOD)으로 그린다
    const drops = {};
    const drop = (key, x, z, ry, tilt = 0) => { const m = this.assets.instantiate(key); if (!m) return; m.position.set(x, heightAt(x, z) - .02, z); m.rotation.set(tilt, ry, rnd() < .3 ? rr(-.5, .5) : 0); m.updateMatrixWorld(true);
      const d = drops[key] || (drops[key] = { parts: partsOf(m), items: [] }); d.items.push(m.matrixWorld.clone()); this.dressed[key] = (this.dressed[key] || 0) + 1; };
    for (let i = 0; i < 34; i++) { const x = rr(-62, 62), z = rr(-1.5, 9); if ([-37, -9, 13, 41].some((g) => Math.abs(x - g) < 2.5)) continue; drop(decor[i % decor.length], x, z, rr(0, 6.28), decor[i % decor.length] === 'decor.tyre' ? rr(1.2, 1.57) : 0); }
    for (const [cx, cz] of [[13, 36], [-27, 18], [0, 76], [-34, 74], [31, 75]]) for (let i = 0; i < 4; i++) drop(decor[(i * 5 + cx) & 3], cx + rr(-4, 4), cz + rr(-4, 4), rr(0, 6.28));
    for (const bx of [-36, 0, 36]) for (let i = 0; i < 3; i++) drop(i ? 'decor.ammobox' : 'decor.crate', bx + rr(-3, 3), -43.5 - rr(0, 1.5), rr(0, 6.28));
    // 부품의 local 은 모델 원점 기준인데 items 는 이미 모델의 월드 변환이므로 그대로 곱하면 된다. 작은 소품: 35m 안 그림자, 85m 밖 숨김
    // 한 개에 8천 삼각형이 넘는 무거운 스캔 모델(녹슨 바퀴 1.6만·나무 상자 2.1만)은 45m 밖에서 숨긴다
    for (const d of Object.values(drops)) { const tris = d.parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0); this.lods.push(new InstanceLOD(this.scene, d.parts, d.items, { near: 35, far: tris > 8000 ? 45 : 85 })); }
  }

  _groundCover() { // 절벽·고지의 풀 포기, 해안 자갈과 흩어진 돌
    const scene = this.scene;
    const a = new THREE.PlaneGeometry(1, 1); a.translate(0, .5, 0); const b = a.clone(); b.rotateY(Math.PI / 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([...a.attributes.uv.array, ...b.attributes.uv.array], 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 24 }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + 4)]);
    const N = 11000, im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.tex.grass, alphaTest: .45, side: THREE.DoubleSide }), N), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    for (let i = 0; i < N; i++) {
      let x, z; do { x = sr(-74, 74); z = -6 - Math.pow(srand(), .8) * 78; } while (z > -42.5 && z < -35.5 && [-36, 0, 36].some((bx) => Math.abs(x - bx) < 4.2));
      const w = sr(.35, .8), h = sr(.16, .42) * (z > -14 ? .6 : 1); e.set(0, sr(0, 3.14), 0); q.setFromEuler(e);
      m.compose(new V3(x, heightAt(x, z) - .03, z), q, new V3(w, h, w)); im.setMatrixAt(i, m);
      const v = sr(.7, 1.25); c.setRGB(.15 * v, .17 * v, .07 * v * sr(.7, 1.3)); im.setColorAt(i, c);
    }
    scene.add(im);
    const R = 900, rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.5, 0), new THREE.MeshStandardMaterial({ flatShading: true }), R);
    for (let i = 0; i < R; i++) {
      const shingle = i < 640, x = sr(-72, 72), z = shingle ? sr(-2.2, 9) - Math.pow(srand(), 2) * 0 : sr(-30, 72), sc = shingle ? sr(.08, .3) : sr(.1, .45);
      e.set(sr(0, 3), sr(0, 3), sr(0, 3)); q.setFromEuler(e); m.compose(new V3(x, heightAt(x, z) + sc * .12, z), q, new V3(sc * sr(.8, 1.6), sc * sr(.5, .9), sc * sr(.8, 1.4))); rocks.setMatrixAt(i, m);
      const v = sr(.12, .3); c.setRGB(v, v * .98, v * .93); rocks.setColorAt(i, c);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);
  }

  // ------------------------------------------------------------- 보급품
  /** 보급품 모양(구급상자 'med' / 탄약 'ammo'). 슬롯 pickups.medkit / pickups.ammo 에 모델이 있으면 그것을 쓴다. */
  /** 보급품 모양. 7단계: 부품(GLB 5조각 등)을 재질별로 합친 메시를 종류별로 공유한다 */
  createPickup(type) { return mergedClone('pickup:' + type, () => this._buildPickup(type)); }
  _buildPickup(type) {
    const M = this.M, g = new THREE.Group(), parts = [];
    const box = (w, h, d, mat, y = 0) => { const m = new THREE.Mesh(unitBox, mat); m.scale.set(w, h, d); m.position.y = y; m.castShadow = true; g.add(m); parts.push(m); };
    if (type === 'med') { box(.42, .3, .3, M.white); box(.24, .08, .31, M.red); box(.08, .24, .31, M.red); }
    else { box(.46, .26, .28, M.crate); box(.47, .05, .29, M.gun, .06); box(.3, .04, .05, M.gun, .16); }
    this.dress(type === 'med' ? 'pickups.medkit' : 'pickups.ammo', g, parts, type === 'med' ? [.42, .3, .3] : [.47, .3, .29], [0, -.15, 0]);
    return g;
  }

  /** 매 프레임: 하늘 위치·셰이더 시간, 바다 출렁임. */
  /** 벙커 실내 재질: 안쪽 면만 그리는 어두운 콘크리트, 전등에서 멀어질수록 어두워지는 주황 발광 */
  _bunkerInterior(lamp) {
    const m = new THREE.MeshStandardMaterial({ color: 0x4a4640, side: THREE.BackSide, roughness: 1, map: this.PM.concrete.map, envMapIntensity: .08 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.lampPos = { value: lamp };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampW;').replace('#include <project_vertex>', '#include <project_vertex>\nvLampW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampW; uniform vec3 lampPos;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 L = lampPos - vLampW; float d2 = dot(L, L); totalEmissiveRadiance += diffuseColor.rgb * vec3(1., .55, .25) * (1.1 / (1. + d2 * 1.6)); }');
    };
    m.customProgramCacheKey = () => 'bunker-interior';
    return m;
  }
  /** 품질 단계 전환: 벙커 실내와 물의 안개 농도 */
  setQuality(q) {
    const high = q === 'high';
    for (const o of this.gfxSwap || []) { if (o.userData.gfxOnly) o.visible = high; else o.material = high ? o.userData.gfx.high : o.userData.gfx.legacy; }
    this.water.material.uniforms.fogDensity.value = this.scene.fog.density;
  }

  update(time, cameraPos) {
    for (const l of this.lods || []) l.update(cameraPos);
    this.sky.position.copy(cameraPos);
    this.sky.material.uniforms.t.value = this.water.material.uniforms.t.value = time;
    this.water.position.y = Math.sin(time * .7) * .05;
  }
}
