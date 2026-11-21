// LightingManager — 태양·하늘광·안개, HDR 하늘 환경광, 총구/폭발 순간광, 1인칭 총기 조명.
import * as THREE from 'three';

const FOG = 0x69727a;

export class LightingManager {
  constructor(renderer) {
    const scene = this.scene = renderer.scene; this.renderer = renderer;
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.FogExp2(FOG, 0.0082);
    /** 안개(=수평선) 색. 물·절차적 하늘 셰이더가 같은 객체를 참조한다. */
    this.fogColor = new THREE.Color(FOG);
    /** 태양 방향(정규화). HDR 하늘을 불러오면 가장 밝은 지점으로 바뀐다. */
    this.sunDir = new THREE.Vector3(-0.62, 0.46, 0.5).normalize();
    /** HDR 밝기 정규화 계수 — 모든 표준 재질의 envMapIntensity 로 쓴다. */
    this.envIntensity = 1;

    this.hemi = new THREE.HemisphereLight(0xa9b8cc, 0x4d4638, 1.55); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffdfb8, 2.5);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    { const c = sun.shadow.camera; c.left = c.bottom = -55; c.right = c.top = 55; c.near = 1; c.far = 220; c.updateProjectionMatrix(); }
    scene.add(sun, sun.target);
    this.muzzle = new THREE.PointLight(0xffc070, 0, 28, 2); scene.add(this.muzzle);
    this.fx = [0, 1].map(() => { const l = new THREE.PointLight(0xffa040, 0, 70, 2); scene.add(l); l.userData.t = 0; return l; });
    // 5단계: 적 총구광 2개(돌려 씀) · 불타는 전차 화염광 · 구름 그림자
    this.enemyMz = [0, 1].map(() => { const l = new THREE.PointLight(0xffb060, 0, 22, 2); scene.add(l); return l; });
    this._emI = 0; this.fires = [];
    /** 구름 그림자: 태양 직사광만 가린다(하늘·환경광은 그대로). strength 0 이면 꺼짐 */
    this.cloud = { strength: { value: .6 }, t: { value: 0 } };
    this._sunBase = sun.intensity;
    this.quality = 'high';
    renderer.onQuality.push((q) => this.setQuality(q));

    const vm = renderer.vmScene;
    this.vmHemi = new THREE.HemisphereLight(0xb8c4d4, 0x3a3428, 1.15); vm.add(this.vmHemi);
    this.vmSun = new THREE.DirectionalLight(0xffe6c8, 3.2); this.vmSun.position.set(-1.2, 1.6, .9); vm.add(this.vmSun);
  }

  /** 발사 순간 월드를 밝히는 총구광. */
  muzzleFlash(pos, intensity) { this.muzzle.intensity = intensity; this.muzzle.position.copy(pos); }
  /** 폭발 순간광(두 개를 번갈아 쓴다). */
  flash(pos, intensity, color = 0xffa040) { const l = this.fx[0].userData.t <= this.fx[1].userData.t ? this.fx[0] : this.fx[1]; l.position.copy(pos); l.position.y += 1; l.color.set(color); l.userData.t = 1; l.userData.i = intensity; }

  /** 적 사격 순간광 — 플레이어 근처(45m)만, 두 개를 번갈아 쓴다. */
  enemyFlash(pos, near, intensity = 60) {
    if (this.quality !== 'high' || pos.distanceToSquared(near) > 45 * 45) return;
    const l = this.enemyMz[this._emI = (this._emI + 1) % 2]; l.position.copy(pos); l.intensity = intensity;
  }
  /** 계속 타는 불(전차 잔해 등). 깜박이는 주황 점광원. */
  addFire(pos, intensity = 26) {
    const l = new THREE.PointLight(0xff7a2c, 0, 18, 2); l.position.copy(pos); l.userData = { base: intensity, ph: Math.random() * 10 };
    l.visible = this.quality === 'high'; this.scene.add(l); this.fires.push(l); return l;
  }
  setQuality(q) {
    this.quality = q; const high = q === 'high';
    for (const l of [...this.enemyMz, ...this.fires]) l.visible = high;
    this.cloud.strength.value = high ? .6 : 0;
    this.sun.intensity = this._sunBase * (high ? 1.3 : 1);   // 구름 사이로 드는 햇빛과 그늘의 대비
    this.scene.fog.density = high ? .0062 : .0082;
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = high ? -48 : -55; this.sun.shadow.camera.right = this.sun.shadow.camera.top = high ? 48 : 55;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /**
   * 구름 그림자를 재질에 심는다. 방향광(태양)의 세기만 세계 좌표 xz 의 흐르는 구름 무늬로 줄인다.
   * 이미 심은 재질은 건너뛰고, 기존 onBeforeCompile(지형 블렌딩 등)은 이어서 실행한다.
   */
  patchMaterial(m) {
    if (!m || !m.isMeshStandardMaterial || m.userData.cloud) return; m.userData.cloud = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m), C = this.cloud;
    m.onBeforeCompile = function (sh, r) {
      prev.call(this, sh, r);
      sh.uniforms.cloudK = C.strength; sh.uniforms.cloudT = C.t;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCloudXZ;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 cw = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  cw = instanceMatrix * cw;
#endif
  vCloudXZ = (modelMatrix * cw).xz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vCloudXZ; uniform float cloudK, cloudT;
float cHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + 1.), f.x), f.y); }
float cloudShade(vec2 xz){ if (cloudK <= 0.) return 1.;
  vec2 p = (xz + vec2(cloudT * 3.2, cloudT * 1.1)) / 46.;
  float n = cNoise(p) * .55 + cNoise(p * 2.13 + 7.1) * .3 + cNoise(p * 4.7 - 3.3) * .15;
  return 1. - cloudK * smoothstep(.46, .72, n); }`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
          .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= cloudShade(vCloudXZ);'));
    };
    m.customProgramCacheKey = () => prevKey() + '|cloud1';
    m.needsUpdate = true;
  }
  /** 장면의 모든 표준 재질에 구름 그림자를 심는다(새로 생긴 재질도 주기적으로). */
  patchScene(scene = this.scene) { scene.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.patchMaterial(m); }); }

  /** 매 프레임: 순간광 감쇠, 화염 깜박임, 구름 이동, 그림자 영역을 플레이어 주변으로(텍셀 단위로 붙여 흔들림 방지). */
  update(dt, focus) {
    this.muzzle.intensity *= Math.exp(-dt * 38);
    for (const l of this.enemyMz) l.intensity *= Math.exp(-dt * 40);
    for (const l of this.fx) { const u = l.userData;
      if (u.t > 0) { u.t -= dt * 3.2; const k = Math.max(0, u.t), high = this.quality === 'high'; l.intensity = u.i * k * k * (.85 + Math.random() * .3) * (high ? .55 : 1);   // 5단계: 노출이 높아 최고 세기를 낮춤
        if (high) l.color.setRGB(1, .42 + .3 * k, .14 + .28 * k * k); }   // 흰노랑 → 주황으로 식는다
      else l.intensity = 0; }
    const tt = (this._ft = (this._ft || 0) + dt);
    for (const l of this.fires) { const u = l.userData; l.intensity = u.base * (.72 + .18 * Math.sin(tt * 13 + u.ph) + .1 * Math.sin(tt * 31.7 + u.ph * 2.3) + Math.random() * .1); }
    this.cloud.t.value += dt;
    if ((this._patchT = (this._patchT || 0) - dt) <= 0) { this._patchT = 3; this.patchScene(); }
    // 그림자 카메라 위치를 빛 공간 텍셀 격자에 맞춘다(움직일 때 그림자 가장자리가 떨리지 않게)
    const sc = this.sun.shadow.camera, texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const right = this._r || (this._r = new THREE.Vector3()), up = this._u || (this._u = new THREE.Vector3());
    right.crossVectors(this.sunDir, THREE.Object3D.DEFAULT_UP).normalize(); up.crossVectors(right, this.sunDir).normalize();
    const a = Math.round(focus.dot(right) / texel) * texel, b = Math.round(focus.dot(up) / texel) * texel, c = focus.dot(this.sunDir);
    const f = this._f || (this._f = new THREE.Vector3()); f.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(this.sunDir, c);
    this.sun.target.position.copy(f); this.sun.position.copy(f).addScaledVector(this.sunDir, 110);
  }

  /**
   * HDR 하늘을 불러와 배경·환경광으로 쓴다. 실패하면 절차적 하늘과 기본 조명을 그대로 유지한다.
   * @param {import('./AssetManager.js').AssetManager} assets
   * @param {object[]} materialSets 아직 장면에 없는 재질 묶음(파편 등)에도 환경광 세기를 맞추기 위해 받는다
   * @returns {Promise<boolean>} 적용 여부
   */
  async loadSky(assets, url, materialSets = []) {
    let tex;
    try { tex = await assets.hdr(url); } catch (e) { return false; }
    const r = this.renderer;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const gen = new THREE.PMREMGenerator(r.gl), env = gen.fromEquirectangular(tex).texture; gen.dispose();
    r.scene.environment = env; r.vmScene.environment = env; r.scene.background = tex;
    const d = tex.image.data, W = tex.image.width, H = tex.image.height, ch = d.length / (W * H);
    // 수평선 색 → 안개색 (먼 바다와 땅이 하늘에 자연스럽게 녹도록)
    let cr = 0, cg = 0, cb = 0, n = 0;
    for (let y = H * .455 | 0; y < H * .49; y++) for (let x = 0; x < W; x += 6) { const i = (y * W + x) * ch; cr += Math.min(d[i], 4); cg += Math.min(d[i + 1], 4); cb += Math.min(d[i + 2], 4); n++; }
    // 파일의 절대 노출과 무관하게 수평선이 일정한 회색이 되도록 정규화
    const k = this.envIntensity = .34 / Math.max(.02, (cr * .2126 + cg * .7152 + cb * .0722) / n);
    r.scene.backgroundIntensity = k; this.fogColor.setRGB(cr / n * k, cg / n * k, cb / n * k).multiplyScalar(.88); r.scene.fog.color.copy(this.fogColor);
    const seen = new Set(), dim = (m) => { if (m && m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); m.envMapIntensity = k; } };
    for (const sc of [r.scene, r.vmScene]) sc.traverse((o) => { if (Array.isArray(o.material)) o.material.forEach(dim); else dim(o.material); });
    for (const set of materialSets) Object.values(set).forEach(dim);
    assets.onTemplateMaterial(dim);
    // 하늘에서 가장 밝은 지점 → 태양 방향
    let best = -1, bx = 0, by = 0; const B = 16;
    for (let y = H * .08 | 0; y < H * .46; y += B) for (let x = 0; x < W; x += B) { let l = 0; for (let a = 0; a < B; a += 4) for (let m = 0; m < B; m += 4) { const i = ((y + a) * W + ((x + m) % W)) * ch; l += Math.min(d[i] + d[i + 1] + d[i + 2], 60); } if (l > best) { best = l; bx = x + B / 2; by = y + B / 2; } }
    const phi = (bx / W - .5) * Math.PI * 2, el = Math.max(.42, (.5 - by / H) * Math.PI);
    this.sunDir.set(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi)).normalize();
    this.hemi.intensity = .35; this._sunBase = 1.7; this.sun.intensity = 1.7 * (this.quality === 'high' ? 1.3 : 1); this.sun.color.set(0xfff1e0); this.vmHemi.intensity = .35; this.vmSun.intensity = 2.;
    return true;
  }
}
