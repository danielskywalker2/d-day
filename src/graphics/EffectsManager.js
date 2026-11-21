// EffectsManager — 파편(피·모래·불꽃·탄피), 연기/섬광 스프라이트, 예광탄, 폭발 연출, 수류탄 모양.
// 오브젝트를 미리 만들어 재사용(풀링)하므로 전투 중 가비지가 거의 생기지 않는다.
import * as THREE from 'three';
import { V3, rand, gauss, lerp, unitBox } from '../core/utils.js';

const MAX_DEBRIS = 700, MAX_SPRITES = 260, MAX_RINGS = 6;
/** 길쭉하게 늘여 날아가는 방향으로 세우는 파편(불꽃·나무 조각) */
const STRETCH = { spark: 5, wood: 3.2, ember: 2.5 };
/** 흙·돌·콘크리트 조각은 상자 대신 울퉁불퉁한 다면체(정점을 흔든 20면체) */
const PEBBLE = (() => { const g = new THREE.IcosahedronGeometry(.62, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.8 + Math.sin(i * 12.9) * .25), p.getY(i) * (.65 + Math.cos(i * 7.3) * .2), p.getZ(i) * (.85 + Math.sin(i * 3.7) * .2)); g.computeVertexNormals(); return g; })();
const PEBBLE_KINDS = new Set(['dirt', 'rock', 'concrete', 'chip', 'sand']);
/** 무기별 총구 효과: 섬광 크기·꽃잎 수·연기 양 */
const MUZZLE = {
  garand: { flash: .8, petals: 2, smoke: 2, smokeSize: .1, smokeLife: 1, alpha: .2 },
  thompson: { flash: .55, petals: 0, smoke: 1, smokeSize: .07, smokeLife: .7, alpha: .16 },
  trench: { flash: 1.25, petals: 4, smoke: 4, smokeSize: .14, smokeLife: 1.4, alpha: .24 },
  springfield: { flash: 1, petals: 3, smoke: 3, smokeSize: .12, smokeLife: 1.3, alpha: .22 },
};

export class EffectsManager {
  constructor({ renderer, lighting, materials, textures }) {
    this.scene = renderer.scene; this.lighting = lighting; this.DMAT = materials.DMAT; this.tex = textures; this.M = materials.M;
    this.debris = []; this.debrisFree = {};
    this.sprites = []; this.spriteFree = { smoke: [], flash: [] };
    this.tracers = []; this.tracerFree = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerMatE = new THREE.MeshBasicMaterial({ color: 0xb8ffb0, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.grenadeGeo = new THREE.SphereGeometry(.07, 8, 6);
    this._v = new V3(); this._z = new V3(0, 0, 1);
    this.decals = []; this.decalPool = []; this.decalIM = {}; this.decalTex = this._decalTextures(); this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.debrisIM = {};
    this.spriteIM = { smoke: this._spriteBatch(this.tex.smoke, THREE.NormalBlending, 2), flash: this._spriteBatch(this.tex.flash, THREE.AdditiveBlending, 3) };
    this.camera = renderer.camera;
    // 폭발 충격파 고리(지면에 눕힌 고리가 빠르게 퍼지며 사라짐)
    this.rings = []; this.ringMat = new THREE.MeshBasicMaterial({ color: 0xd8c8a0, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide });
    this.ringGeo = new THREE.RingGeometry(.86, 1, 48, 1).rotateX(-Math.PI / 2);
    /** 프레임당 효과 수 통계(디버그·성능 확인용) */
    this.counts = { impacts: 0, dropped: 0 };
  }
  /** 카메라에서 먼 효과는 파편 수를 줄인다(LOD): 1 → 0.15 */
  _lod(pos) { const d = pos.distanceTo(this.camera.position); return d < 25 ? 1 : d < 60 ? .55 : d < 120 ? .25 : .12; }
  _n(n, k) { const x = n * k; return (x | 0) + (Math.random() < x % 1 ? 1 : 0); }

  // ---------------------------------------------------------------- 6단계: 총구·탄착·폭발
  /** 플레이어 총구 효과: 앞으로 뻗는 섬광 꽃잎 + 무기별 연기 */
  muzzle(id, pos, dir) {
    const c = MUZZLE[id] || MUZZLE.garand, v = this._v;
    for (let i = 1; i <= c.petals; i++) this.sprite('flash', v.copy(pos).addScaledVector(dir, i * .09 * c.flash), { size: c.flash * (.5 - i * .08), life: .04, color: 0xffd9a0 });
    // 연기는 총구 앞 0.3~1.2m 에서 생겨 앞으로 밀려나며 퍼진다(바로 눈앞을 가리지 않게 작고 옅게)
    for (let i = 0; i < c.smoke; i++) this.sprite('smoke', v.copy(pos).addScaledVector(dir, rand(.3, 1.2)), { size: c.smokeSize * rand(.7, 1.2), grow: 6, life: c.smokeLife * rand(.7, 1.1), alpha: c.alpha, color: 0xcfcfcf, rise: rand(.25, .55), vx: dir.x * rand(.8, 1.8), vz: dir.z * rand(.8, 1.8) });
  }
  /** 총구에서 피어오르는 가는 연기(연사 뒤 총열 열기) */
  wisp(pos) { this.sprite('smoke', pos, { size: .08, grow: 5, life: 1.1, alpha: .3, color: 0xd8d8d8, rise: .45, vx: rand(-.05, .05) }); }
  /**
   * 재질별 탄착 효과. surface: concrete | metal | wood | sand | water | flesh
   * normal: 표면 법선(없으면 위), dir: 탄의 진행 방향, k: 세기(산탄 1발 = 0.4)
   */
  impact(surface, pos, normal, dir, k = 1) {
    const L = this._lod(pos) * k, n = normal || this._up || (this._up = new V3(0, 1, 0)), v = this._v, b = this._b || (this._b = new V3());
    b.copy(n).multiplyScalar(2.2); if (dir) b.addScaledVector(dir, -.6);   // 표면에서 튀어나오는 방향(반사 쪽)
    this.counts.impacts++;
    if (surface === 'metal') {
      this.debrisBurst('spark', pos, this._n(12, L), 5.5, 1.2, .025, .32, b);
      this.sprite('flash', v.copy(pos).addScaledVector(n, .05), { size: .35, life: .05, color: 0xffe0a0 });
      if (L > .3) this.sprite('smoke', pos, { size: .18, grow: 3, life: .35, alpha: .35, color: 0x9a9a95, rise: .3 });
    } else if (surface === 'concrete') {
      this.debrisBurst('concrete', pos, this._n(8, L), 2.6, 1.6, .055, .9, b);
      this.debrisBurst('spark', pos, this._n(2, L), 3.5, 1, .02, .15, b);
      this.sprite('smoke', v.copy(pos).addScaledVector(n, .12), { size: .3, grow: 4.5, life: .9, alpha: .55, color: 0xc4c0b6, rise: .35, vx: n.x * .6, vz: n.z * .6 });
      if (L > .5) this.sprite('smoke', v.copy(pos).addScaledVector(n, .3), { size: .2, grow: 3, life: .5, alpha: .4, color: 0xd8d4ca, rise: .2 });
    } else if (surface === 'wood') {
      this.debrisBurst('wood', pos, this._n(7, L), 3, 1.8, .05, .9, b);
      this.sprite('smoke', v.copy(pos).addScaledVector(n, .1), { size: .2, grow: 3, life: .45, alpha: .35, color: 0x9a8264, rise: .25 });
    } else if (surface === 'water') {
      this.debrisBurst('water', pos, this._n(10, L), 1.2, 4.2, .07, .7);
      this.sprite('smoke', pos, { size: .35, grow: 2.5, life: .45, alpha: .55, color: 0xe2ecf0, rise: 1.6 });
    } else if (surface === 'flesh') {
      this.debrisBurst('blood', pos, this._n(8, L), 2.2, 1.6, .07, .8, dir ? v.copy(dir).multiplyScalar(3) : null);
      this.sprite('smoke', pos, { size: .35, grow: 3, life: .28, alpha: .7, color: 0x8a0d0a });
    } else {   // 모래: 솟구치는 모래 기둥 + 낮게 퍼지는 먼지
      this.debrisBurst('sand', pos, this._n(7, L), 1.4, 3.6, .07, .7);
      this.sprite('smoke', v.copy(pos).setY(pos.y + .15), { size: .4, grow: 3.8, life: .8, alpha: .5, color: 0xb0a07c, rise: 1.1 });
      if (L > .5) this.sprite('smoke', pos, { size: .5, grow: 3, life: 1.1, alpha: .3, color: 0xa39472, rise: .2, vx: rand(-.4, .4), vz: rand(-.4, .4) });
    }
  }

  // ---------------------------------------------------------------- 흔적(데칼): 발자국·총탄 자국·그을음
  _decalTextures() {
    const mk = (draw, n = 128) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const blot = (g, x, y, r, a, col = '0,0,0') => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    return {
      // 모래에 박힌 탄: 가운데 움푹한 어둠 + 튀어 나간 모래 테
      hole: mk((g, n) => { blot(g, n / 2, n / 2, n * .48, .55, '70,55,35'); blot(g, n / 2, n / 2, n * .22, .95, '18,13,8'); for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = n * (.22 + Math.random() * .2); blot(g, n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, n * .06, .5, '60,48,30'); } }),
      // 콘크리트·강철에 맞은 자국: 밝게 깨진 테 + 검은 구멍
      chip: mk((g, n) => { blot(g, n / 2, n / 2, n * .45, .55, '215,210,200'); blot(g, n / 2, n / 2, n * .16, .95, '15,15,15'); for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28; g.strokeStyle = 'rgba(30,30,30,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(n / 2, n / 2); g.lineTo(n / 2 + Math.cos(a) * n * .4, n / 2 + Math.sin(a) * n * .4); g.stroke(); } }),
      // 포탄 그을음: 불규칙한 검은 얼룩
      scorch: mk((g, n) => { blot(g, n / 2, n / 2, n * .5, .8, '12,10,8'); for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = n * Math.random() * .38; blot(g, n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, n * (.06 + Math.random() * .12), .5, '8,7,6'); } }, 256),
      // 군화 발자국: 밑창과 뒤꿈치, 징 자국
      foot: mk((g, n) => {
        g.save(); g.translate(n / 2, n / 2);
        const sole = (k) => { g.beginPath(); g.moveTo(-n * .12 * k, -n * .36 * k); g.bezierCurveTo(-n * .21 * k, -n * .3 * k, -n * .2 * k, -n * .02 * k, -n * .13 * k, n * .06 * k); g.lineTo(-n * .11 * k, n * .2 * k); g.bezierCurveTo(-n * .13 * k, n * .42 * k, n * .13 * k, n * .42 * k, n * .11 * k, n * .2 * k); g.lineTo(n * .14 * k, n * .04 * k); g.bezierCurveTo(n * .22 * k, -n * .08 * k, n * .17 * k, -n * .42 * k, -n * .12 * k, -n * .36 * k); g.closePath(); };
        g.fillStyle = 'rgba(90,72,48,.35)'; sole(1.15); g.fill();                       // 밀려난 모래 테
        g.fillStyle = 'rgba(34,25,14,.72)'; sole(1); g.fill();                          // 눌린 바닥
        g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.45)';   // 밑창 홈(가로 줄)
        for (let y = -n * .32; y < n * .36; y += n * .055) if (y < n * .08 || y > n * .16) g.fillRect(-n * .2, y, n * .4, n * .018);
        g.restore();
      }),
    };
  }
  /** 표면에 붙는 흔적. kind: hole|chip|scorch|foot, normal: 표면 법선, size: 지름(m), life: 초
   *  7단계: 흔적마다 메시를 만들지 않고 종류별 InstancedMesh 하나로 그린다(사라질 때의 투명도는 인스턴스 속성). 최대 360개 */
  decal(kind, pos, normal, size, rot = Math.random() * 6.28, life = 40) {
    const m = this.decals.length >= 360 ? this.decals.shift() : (this.decalPool.pop() || new THREE.Object3D());
    m.userData = { kind, life, max: life };
    m.quaternion.setFromUnitVectors(this._z, normal); m.rotateZ(rot);
    m.position.copy(pos).addScaledVector(normal, .015); m.scale.set(size, size, 1); m.updateMatrix();
    this.decals.push(m);
  }
  _decalMesh(kind) {
    let im = this.decalIM[kind]; if (im) return im;
    const mat = new THREE.MeshStandardMaterial({ map: this.decalTex[kind], transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iAlpha; varying float vIAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvIAlpha = iAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vIAlpha;').replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vIAlpha;');
    };
    mat.customProgramCacheKey = () => 'decal-inst';
    im = new THREE.InstancedMesh(this.decalGeo, mat, 360); im.count = 0; im.renderOrder = 1; im.receiveShadow = true; im.frustumCulled = false;
    im.geometry = this.decalGeo.clone(); im.geometry.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(new Float32Array(360), 1));
    this.scene.add(im); return (this.decalIM[kind] = im);
  }
  _updateDecals(dt) {
    for (let i = this.decals.length - 1; i >= 0; i--) { const m = this.decals[i], u = m.userData; u.life -= dt; if (u.life <= 0) { this.decalPool.push(m); this.decals.splice(i, 1); } }
    for (const im of Object.values(this.decalIM)) im.count = 0;
    for (const m of this.decals) { const u = m.userData, im = this._decalMesh(u.kind), i = im.count++; im.setMatrixAt(i, m.matrix); im.geometry.attributes.iAlpha.array[i] = Math.min(1, u.life / (u.max * .25)); }
    for (const im of Object.values(this.decalIM)) { im.instanceMatrix.needsUpdate = true; im.geometry.attributes.iAlpha.needsUpdate = true; im.visible = im.count > 0; }
  }
  /** 카메라를 향한 사각형 인스턴스(스프라이트 대신). 인스턴스마다 색·투명도·회전, 안개 적용 */
  _spriteBatch(map, blending, order) {
    const n = MAX_SPRITES + 2, geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)); geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]), fog: true, transparent: true, depthWrite: false, blending,
      vertexShader: `#include <common>
#include <fog_pars_vertex>
attribute vec4 iColor; attribute float iRot; varying vec2 vUv; varying vec4 vCol;
void main() { vUv = uv; vCol = iColor;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
  float sc = length(instanceMatrix[0].xyz), c = cos(iRot), s = sin(iRot);
  mvPosition.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * sc;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: `#include <common>
#include <fog_pars_fragment>
uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a);
  #include <fog_fragment>
}` });
    mat.uniforms.map.value = map;
    const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.frustumCulled = false; im.renderOrder = order; this.scene.add(im); return im;
  }
  _drawSprites() {
    const m4 = this._m4 || (this._m4 = new THREE.Matrix4());
    for (const im of Object.values(this.spriteIM)) im.count = 0;
    for (const s of this.sprites) { const im = this.spriteIM[s.userData.kind], i = im.count++, c = im.geometry.attributes.iColor.array;
      m4.makeScale(s.size, s.size, s.size).setPosition(s.position); im.setMatrixAt(i, m4);
      c[i * 4] = s.color.r; c[i * 4 + 1] = s.color.g; c[i * 4 + 2] = s.color.b; c[i * 4 + 3] = s.opacity; im.geometry.attributes.iRot.array[i] = s.rot; }
    for (const im of Object.values(this.spriteIM)) { im.instanceMatrix.needsUpdate = true; im.geometry.attributes.iColor.needsUpdate = true; im.geometry.attributes.iRot.needsUpdate = true; im.visible = im.count > 0; }
  }
  /** 파편을 종류별 InstancedMesh 로 그린다(파편이 수백 개여도 Draw Call 은 종류 수만큼) */
  _drawDebris() {
    for (const im of Object.values(this.debrisIM)) im.count = 0;
    for (const m of this.debris) { const k = m.userData.kind; let im = this.debrisIM[k];
      if (!im) { im = this.debrisIM[k] = new THREE.InstancedMesh(PEBBLE_KINDS.has(k) ? PEBBLE : unitBox, this.DMAT[k], MAX_DEBRIS); im.count = 0; im.frustumCulled = false; this.scene.add(im); }
      m.updateMatrix(); im.setMatrixAt(im.count++, m.matrix); }
    for (const im of Object.values(this.debrisIM)) { im.instanceMatrix.needsUpdate = true; im.visible = im.count > 0; }
  }
  /** 튀는 파편 n개. kind: blood|sand|dirt|spark|chip|water|brass */
  debrisBurst(kind, pos, n, spd, up, size, life, bias) {
    for (let i = 0; i < n; i++) {
      if (this.debris.length >= MAX_DEBRIS) { this.counts.dropped += n - i; return; }
      let m = (this.debrisFree[kind] || (this.debrisFree[kind] = [])).pop();
      if (!m) { m = new THREE.Object3D(); m.userData = { v: new V3() }; }   // 7단계: 장면에 넣지 않는 위치 정보만 — 그리기는 종류별 InstancedMesh 한 번
      const u = m.userData, s = size * rand(.5, 1.4);
      m.visible = true; m.position.copy(pos); m.scale.setScalar(s);
      u.kind = kind; u.s = s; u.max = u.life = life * rand(.6, 1.25); u.b = 0; u.st = STRETCH[kind] || 0;
      u.v.set(gauss() * spd, Math.abs(gauss()) * spd * .7 + up * rand(.5, 1.2), gauss() * spd); if (bias) u.v.addScaledVector(bias, rand(.4, 1));
      this.debris.push(m);
    }
  }
  /** 연기('smoke') 또는 섬광('flash') 스프라이트. o: { size, grow, life, alpha, color, rise, vx, vz, force }
   *  상한에 닿으면 버린다. force(폭발 등 중요한 효과)면 가장 오래된 연기를 빼앗아 쓴다. */
  sprite(kind, pos, o) {
    if (this.sprites.length > MAX_SPRITES) {
      if (!o.force) { this.counts.dropped++; return; }
      const i = this.sprites.findIndex((x) => x.userData.kind === 'smoke'); if (i < 0) return;
      const old = this.sprites[i]; old.visible = false; this.spriteFree.smoke.push(old); this.sprites[i] = this.sprites[this.sprites.length - 1]; this.sprites.pop();
    }
    // 7단계: 연기·섬광은 장면 객체가 아니라 위치·색 정보만 — 그리기는 종류별 카메라를 향한 사각형 인스턴스 한 번
    let s = this.spriteFree[kind].pop();
    if (!s) s = { position: new V3(), color: new THREE.Color(), size: 1, opacity: 1, rot: 0, visible: true, userData: null };
    s.visible = true; s.position.copy(pos); s.color.set(o.color ?? 0xffffff); if (kind === 'flash') s.color.multiplyScalar(3); s.rot = rand(6.28);
    s.userData = { kind, life: o.life, max: o.life, s0: o.size, s1: o.size * (o.grow ?? 1), a: o.alpha ?? 1, vy: o.rise ?? 0, vx: o.vx ?? 0, vz: o.vz ?? 0 };
    s.size = o.size; s.opacity = s.userData.a; this.sprites.push(s);
  }
  /** 날아가는 예광탄. enemy=true 면 녹색(독일군). */
  tracer(from, to, enemy) {
    let m = this.tracerFree.pop(); if (!m) { m = new THREE.Mesh(unitBox, this.tracerMat); this.scene.add(m); m.userData = { o: new V3(), d: new V3() }; }
    const u = m.userData; u.o.copy(from); u.d.subVectors(to, from); u.len = u.d.length(); if (u.len < 1) { this.tracerFree.push(m); m.visible = false; return; } u.d.multiplyScalar(1 / u.len);
    u.t = 0; u.speed = enemy ? 190 : 420; u.seg = enemy ? 9 : 14; m.material = enemy ? this.tracerMatE : this.tracerMat; m.visible = true; m.quaternion.setFromUnitVectors(this._z, u.d); this.tracers.push(m);
  }
  /** 폭발의 눈에 보이는 부분(섬광·순간광·파편·연기). 피해 계산은 게임 로직이 한다. */
  explosion(pos, radius) {
    const wet = pos.y < 0.15 && pos.z > 72, v = this._v, R = radius / 6, F = { force: true };
    // 1) 섬광 + 불덩이(0.3초)
    this.sprite('flash', v.copy(pos).setY(pos.y + .8), { size: radius * 1.5, grow: 1.6, life: .14, ...F });
    for (let i = 0; i < 4; i++) this.sprite('flash', v.set(pos.x + gauss() * .7 * R, pos.y + rand(.4, 1.6) * R, pos.z + gauss() * .7 * R), { size: rand(1.4, 2.4) * R, grow: 1.8, life: rand(.22, .36), color: 0xff8a3a, rise: 2, ...F });
    this.lighting.flash(pos, 900);
    // 2) 충격파: 지면 고리 + 바깥으로 밀려나는 먼지 고리
    this._ring(pos, radius * 3.2, .38);
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283 + rand(-.2, .2), sp = rand(4, 7) * R; this.sprite('smoke', v.set(pos.x + Math.cos(a) * .8, pos.y + .25, pos.z + Math.sin(a) * .8), { size: rand(.9, 1.4) * R, grow: 3.2, life: rand(1, 1.6), alpha: .5, color: wet ? 0xdfe8ea : 0xb3a483, rise: .3, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, ...F }); }
    // 3) 흙 기둥·돌·불씨
    this.debrisBurst(wet ? 'water' : 'sand', pos, 46, 5, 9, .16, 1.6); this.debrisBurst('dirt', pos, 26, 6.5, 10, .2, 1.8);
    if (!wet) { this.debrisBurst('rock', pos, 10, 7, 8, .14, 2.2); this.debrisBurst('ember', pos, 14, 6, 7, .05, .9); }
    // 4) 연기: 아래는 흙먼지(밝고 넓게), 위로는 검은 연기 기둥(오래)
    for (let i = 0; i < 7; i++) this.sprite('smoke', v.set(pos.x + gauss() * 1.2, pos.y + rand(.3, 1.6), pos.z + gauss() * 1.2), { size: rand(2, 3.4), grow: 2.6, life: rand(1.6, 3.2), alpha: .75, color: i < 3 ? 0x2c2a26 : 0x8a7d62, rise: rand(1, 2.6), vx: rand(.5, 1.5), ...F });
    for (let i = 0; i < 4; i++) this.sprite('smoke', v.set(pos.x + gauss() * .6, pos.y + 2 + i * 1.2, pos.z + gauss() * .6), { size: rand(1.8, 2.6) * R, grow: 3, life: rand(4, 6.5), alpha: .55, color: 0x2a2826, rise: rand(1.6, 2.4), vx: rand(.6, 1.4), ...F });
  }
  _ring(pos, size, life) {
    let m = this.rings.find((r) => !r.visible);
    if (!m) { if (this.rings.length >= MAX_RINGS) return; m = new THREE.Mesh(this.ringGeo, this.ringMat.clone()); m.renderOrder = 2; this.scene.add(m); this.rings.push(m); }
    m.visible = true; m.position.copy(pos); m.position.y += .15; m.userData = { t: 0, life, size }; m.scale.setScalar(.1);
  }
  /** 수류탄 모양을 장면에 추가해서 돌려준다. */
  grenadeMesh(pos) { const m = new THREE.Mesh(this.grenadeGeo, this.M.od); m.position.copy(pos); this.scene.add(m); return m; }
  remove(obj) { this.scene.remove(obj); }

  /** 매 프레임: 파편 물리(지면에 닿으면 소멸, 탄피는 튕김), 스프라이트 페이드, 예광탄 이동. */
  update(dt, groundAt) {
    const { debris, sprites, tracers } = this;
    this._updateDecals(dt);
    for (let i = debris.length - 1; i >= 0; i--) { const m = debris[i], u = m.userData; u.life -= dt; u.v.y -= (u.kind === 'ember' ? 6 : 15) * dt; m.position.addScaledVector(u.v, dt);
      if (u.st) { const sp = u.v.length(); if (sp > .01) m.quaternion.setFromUnitVectors(this._z, this._v.copy(u.v).multiplyScalar(1 / sp)); const k = u.life < u.max * .3 ? Math.max(.01, u.life / (u.max * .3)) : 1; m.scale.set(u.s * .35 * k, u.s * .35 * k, u.s * u.st * k); }
      else { m.rotation.x += dt * 9; m.rotation.z += dt * 7; if (u.life < u.max * .3) m.scale.setScalar(u.s * Math.max(.01, u.life / (u.max * .3))); }
      if (u.v.y < 0 && m.position.y < groundAt(m.position.x, m.position.z) + .02) { if (u.kind === 'brass' && u.b < 2) { u.b++; u.v.y *= -.4; u.v.x *= .5; u.v.z *= .5; m.position.y += .03; } else u.life = 0; }
      if (u.life <= 0) { m.visible = false; this.debrisFree[u.kind].push(m); debris[i] = debris[debris.length - 1]; debris.pop(); } }
    this._drawDebris();
    for (let i = sprites.length - 1; i >= 0; i--) { const s = sprites[i], u = s.userData; u.life -= dt; const k = 1 - Math.max(0, u.life) / u.max;
      s.size = lerp(u.s0, u.s1, 1 - (1 - k) * (1 - k)); s.opacity = u.a * (1 - k) * (u.kind === 'flash' ? 1 : Math.min(1, k * 8 + .3)); s.position.y += u.vy * dt; s.position.x += u.vx * dt; s.position.z += u.vz * dt; if (u.vz) { const dmp = Math.exp(-dt * 1.6); u.vx *= dmp; u.vz *= dmp; }
      if (u.life <= 0) { s.visible = false; this.spriteFree[u.kind].push(s); sprites[i] = sprites[sprites.length - 1]; sprites.pop(); } }
    this._drawSprites();
    for (const m of this.rings) { if (!m.visible) continue; const u = m.userData; u.t += dt; const k = u.t / u.life; if (k >= 1) { m.visible = false; continue; }
      m.scale.setScalar(.2 + u.size * (1 - (1 - k) * (1 - k))); m.material.opacity = .5 * (1 - k); }
    for (let i = tracers.length - 1; i >= 0; i--) { const m = tracers[i], u = m.userData; u.t += dt; const head = Math.min(u.len, u.t * u.speed), tail = Math.max(0, head - u.seg), L = Math.max(.05, head - tail);
      m.position.copy(u.o).addScaledVector(u.d, (head + tail) / 2); m.scale.set(.035, .035, L);
      if (u.t * u.speed >= u.len + u.seg) { m.visible = false; this.tracerFree.push(m); tracers[i] = tracers[tracers.length - 1]; tracers.pop(); } }
  }
}
