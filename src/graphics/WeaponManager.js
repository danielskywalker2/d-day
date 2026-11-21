// WeaponManager — 1인칭 총기(뷰모델): 모양, 손, 총구 섬광, 그리고 무기별 애니메이션.
//
// 규칙(탄약·피해·연사·재장전 시간)은 game.js 가 갖고, 여기서는 "보이는 것"만 다룬다.
// game.js 는 매 프레임 상태 묶음(조준·반동·현재 동작과 진행률)을 넘기고, 여기서 그 상태를 자세로 바꾼다.
//
// 애니메이션 리그
//   · 총 전체: 반동, 조준, 걷기 흔들림, 숨쉬기, 교체(내림/올림), 점검, 재장전 기울임
//   · 부품(parts): bolt(노리쇠) · handle(볼트 손잡이 회전) · mag(탄창) · clip(엔블록 클립) · pump(펌프) · round(손에 든 탄)
//   · 손: 오른손(손잡이)·왼손(총몸 앞)을 목표 위치로 옮기고, 팔은 어깨에서 손까지 늘어난다
// GLB 슬롯(weapons.<id>)에 모델이 있으면 절차적 총기 메시를 숨기고 모델을 붙인다. 부품은 매니페스트의
// "parts": { "bolt": "노드 이름", ... } 로 연결한다. 연결할 노드가 없는 부품은 움직이지 않는다(총 전체 동작만 재생).
import * as THREE from 'three';
import { V3, rand, clamp, lerp, unitBox } from '../core/utils.js';

const PI = Math.PI;
/** a~b 구간에서 0→1→0 으로 부드럽게 솟는 값 */
const bump = (p, a, b) => (p <= a || p >= b ? 0 : Math.sin(PI * (p - a) / (b - a)));
/** a~b 구간에서 0→1 로 부드럽게 오르는 값 */
const ramp = (p, a, b) => { const t = clamp((p - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** a에서 오르고 b에서 내려오는 사다리꼴(올림·내림 각 w) */
const hold = (p, a, b, w = .08) => ramp(p, a, a + w) * (1 - ramp(p, b - w, b));

export class WeaponManager {
  constructor({ renderer, assets, materials, textures }) {
    this.vmScene = renderer.vmScene; this.assets = assets; this.VM = materials.VM; this.tex = textures;
    this.root = new THREE.Group(); this.vmScene.add(this.root);
    this.views = [];
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.flash, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.flash.material.color.setScalar(3); this.flash.visible = false; this.root.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2); this.flashLight.position.set(0.2, -0.05, -1); this.vmScene.add(this.flashLight);
    this.flashT = 0; this.spr = 0; this.active = 0; this.time = 0;
    this._unitSph = new THREE.SphereGeometry(.5, 14, 10);
    this._armGeo = new THREE.CylinderGeometry(.05, .034, 1, 12); this._armGeo.translate(0, .5, 0);   // 밑동이 원점, +Y 로 길이 1
    this.brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a03a, metalness: .9, roughness: .3 });
    this.debris = [];   // 1인칭 공간에서 튀어나가는 탄피·클립
    this._v = new V3(); this._hp = new V3(); this._hd = new V3(); this._q = new THREE.Quaternion(); this._up = new V3(0, 1, 0);
  }

  /** 무기 정의 목록(id 필드 필요)으로 뷰모델을 만든다. */
  build(defs) {
    const builders = { garand: () => this._garand(), thompson: () => this._thompson(), trench: () => this._trench(), springfield: () => this._springfield() };
    this.views = defs.map((def) => {
      const v = builders[def.id] ? builders[def.id]() : { g: new THREE.Group(), muzzle: new V3(0, 0, -.6), parts: {}, rest: {} };
      v.id = def.id; v.def = def; v.g.visible = false; this.root.add(v.g);
      v.parts = v.parts || {};
      this._dress(v);
      this._captureRest(v);
      return v;
    });
    this.setActive(0);
    return this.views;
  }
  setActive(i) { this.views.forEach((v, k) => { v.g.visible = k === i; }); this.active = i; }
  get view() { return this.views[this.active]; }

  /** 발사 순간의 총구 섬광(크기 = 무기의 flash 값). */
  fire(size) { this.flashT = .055; this.flash.material.rotation = rand(6.28); this.flash.scale.setScalar(size * rand(.8, 1.25)); }
  /** 탄피 하나를 총 옆으로 튕겨낸다(1인칭 공간). */
  ejectCasing() { const v = this.view; this._spawnDebris(this._casingMesh(v.id === 'trench' ? 'shell' : 'brass'), v.ejectPort || new V3(.03, .05, -.05), new V3(rand(.9, 1.4), rand(.9, 1.3), rand(-.2, .2)), 1.1); }
  /** M1 개런드: 빈 엔블록 클립이 "핑" 하고 튀어나간다. */
  ejectClip() { const v = this.view; this._spawnDebris(this._clipMesh(true), v.clipPos || new V3(0, .06, .02), new V3(rand(.1, .4), rand(2.2, 2.8), rand(.1, .3)), 1.2); }

  /**
   * 매 프레임 자세 갱신.
   * @param {number} dt
   * @param {object} s { ads, kick, kickRot, swayX, swayY, walkT, moveAmt, sprinting, switchT, switchDur,
   *                    action: { name: 'reload'|'bolt'|'pump'|'inspect'|null, p: 0..1, rounds }, sinceFire, ammo, hidden }
   */
  update(dt, s) {
    this.time += dt;
    const v = this.views[this.active];
    this.root.visible = !s.hidden;
    const bob = s.moveAmt * (1 - s.ads * .85), bx = Math.sin(s.walkT) * .012 * bob, by = Math.abs(Math.cos(s.walkT)) * .012 * bob;
    const breathe = Math.sin(this.time * 1.7) * .0025 * (1 - s.ads * .7);
    let low = 0; if (s.switchT > 0) low = Math.sin(PI * (1 - s.switchT / s.switchDur));
    this.spr = lerp(this.spr, s.sprinting ? 1 : 0, Math.min(1, dt * 9));

    // 동작별 자세: 총 전체 오프셋 G, 부품 오프셋, 손 목표
    const A = this._animate(v, s);
    const hipX = .15, hipY = -.15, hipZ = -.5, adsY = v.adsY ?? -.079, adsZ = v.adsZ ?? -.3;
    const ads = s.ads * (1 - A.noAds);
    this.root.position.set(lerp(hipX, 0, ads) + bx + s.swayX + this.spr * .05 + A.x, lerp(hipY, adsY, ads) - by - low * .28 + s.swayY - this.spr * .05 + breathe + A.y, lerp(hipZ, adsZ, ads) + s.kick + A.z);
    this.root.rotation.set(s.kickRot * .9 - low * .7 - this.spr * .25 + s.swayY * 2 + A.rx, lerp(.03, 0, ads) + this.spr * .5 + s.swayX * 3 + A.ry, low * .3 + bx * 2 + A.rz);

    // 부품
    const P = v.parts, R = v.rest;
    if (P.bolt) P.bolt.position.copy(R.bolt).addScaledVector(v.boltAxis || this._v.set(0, 0, 1), A.bolt);
    if (P.handle) { P.handle.rotation.copy(R.handleRot); P.handle.rotateOnAxis(v.handleAxis || new V3(0, 0, 1), A.handle); if (v.handleFollow) P.handle.position.copy(R.handle).addScaledVector(v.handleFollow, A.bolt); }
    if (P.pump) P.pump.position.copy(R.pump).add(this._v.set(0, 0, A.pump));
    if (P.mag) { P.mag.position.copy(R.mag).add(this._v.set(0, A.magY, A.magZ)); P.mag.rotation.copy(R.magRot); P.mag.rotation.x += A.magRx; }
    if (P.clip) { P.clip.visible = A.clipVis || (v.clipLoaded && s.ammo > 0 && !(s.action && s.action.name === 'reload')); P.clip.position.copy(R.clip).add(this._v.set(0, A.clipY, A.clipZ)); }
    if (P.round) { P.round.visible = A.roundVis; P.round.position.copy(R.round).add(this._v.set(0, A.roundY, A.roundZ)); }

    // 손
    if (v.hands) {
      this._placeHand(v.hands.R, this._hp.copy(v.gripR).add(A.dR));
      this._placeHand(v.hands.L, this._hp.copy(v.gripL).add(A.dL));
    }

    this.flashT -= dt; this.flash.visible = this.flashT > 0 && !s.hidden; if (this.flash.visible) this.flash.position.copy(v.muzzle);
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    this._updateDebris(dt);
  }

  // ------------------------------------------------------------- 동작 정의
  _animate(v, s) {
    const A = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, bolt: 0, handle: 0, pump: 0, magY: 0, magZ: 0, magRx: 0, clipY: 0, clipZ: 0, clipVis: false, roundY: 0, roundZ: 0, roundVis: false, dL: new V3(), dR: new V3(), noAds: 0 };
    const act = s.action || {}, p = act.p ?? 0, id = v.id;
    // 발사 직후 노리쇠 왕복 (반자동·자동)
    if ((id === 'garand' || id === 'thompson') && s.sinceFire < .09) A.bolt = Math.sin(PI * s.sinceFire / .09) * (v.boltTravel || .05);
    if (id === 'garand' && s.ammo === 0 && act.name !== 'reload') A.bolt = v.boltTravel || .05;          // 마지막 탄 뒤 노리쇠 후퇴 고정
    if (id === 'springfield' && s.ammo === 0 && act.name !== 'reload' && act.name !== 'bolt') { A.handle = v.handleOpen || 1.15; A.bolt = v.boltTravel || .1; }

    if (act.name === 'reload') {
      A.noAds = 1;
      if (id === 'garand') {          // 엔블록 클립 장전: 기울임 → 노리쇠 후퇴 → 클립 꺼냄 → 밀어넣기 → 노리쇠 전진
        const tilt = hold(p, 0, 1, .12); A.rz += .45 * tilt; A.rx += -.18 * tilt; A.y += -.03 * tilt; A.x += -.03 * tilt;
        A.bolt = (v.boltTravel || .05) * hold(p, .1, .8, .06);
        const reach = bump(p, .2, .55); A.dL.set(-.05 * reach, -.3 * reach, .18 * reach);
        const toTop = ramp(p, .45, .62), push = ramp(p, .62, .72);
        A.clipVis = p > .4 && p < .74; A.clipY = .2 * (1 - toTop) - .045 * push; A.clipZ = .1 * (1 - toTop);
        A.dL.add(this._v.set(0, (.1 + .02) * toTop * (1 - push * .3), .32 * toTop * (1 - ramp(p, .74, .86))));
        A.ry += .05 * bump(p, .74, .8);
      } else if (id === 'thompson') { // 탄창 교환: 기울임 → 빼기 → 새 탄창 → 끼우기 → 장전 손잡이
        const tilt = hold(p, 0, 1, .12); A.rz += -.35 * tilt; A.rx += -.1 * tilt; A.y += -.025 * tilt;
        const out = ramp(p, .12, .28), fetch = ramp(p, .3, .5), seat = ramp(p, .5, .6);
        A.magY = -.32 * out * (1 - fetch) - .32 * (1 - seat) * fetch; A.magRx = .3 * out * (1 - seat);
        A.dL.set(.0, -.32 * bump(p, .1, .62) + .06, .2 * hold(p, .1, .62));
        A.y += -.008 * bump(p, .57, .62);
        const rack = bump(p, .66, .84); A.bolt = (v.boltTravel || .05) * 1.6 * rack; A.dR.set(.03 * hold(p, .64, .86), .1 * hold(p, .64, .86), -.19 * hold(p, .64, .86));
      } else if (id === 'trench' || id === 'springfield') { // 한 발씩 장전
        const isSF = id === 'springfield', n = Math.max(1, act.rounds || 1);
        const open = isSF ? .14 : .1, close = isSF ? .86 : .9, tilt = hold(p, 0, 1, .1);
        A.rz += (isSF ? .32 : .75) * tilt; A.rx += -.12 * tilt; A.y += -.02 * tilt;
        if (isSF) { A.handle = (v.handleOpen || 1.15) * hold(p, .02, .98, .07); A.bolt = (v.boltTravel || .1) * hold(p, .06, .94, .07); A.dR.copy(this._handleTarget(v)).multiplyScalar(hold(p, 0, 1, .1)); }
        const inner = clamp((p - open) / (close - open), 0, .9999), k = inner * n, f = k - Math.floor(k);
        if (p > open && p < close) {
          A.roundVis = f < .82; A.roundY = (isSF ? .14 : -.14) * (1 - ramp(f, .25, .7)); A.roundZ = (isSF ? 0 : .06) * (1 - ramp(f, .25, .7));
          const reach = Math.sin(PI * f);
          if (isSF) A.dL.set(.04 * reach, .16 * reach, .2 * reach); else A.dL.set(0, -.12 * reach, .12 * reach);
        }
      }
    } else if (act.name === 'bolt') { // 볼트액션: 손잡이 올림 → 후퇴(탄피 배출) → 전진 → 내림
      const up = ramp(p, .05, .2) * (1 - ramp(p, .72, .88)), back = ramp(p, .2, .42) * (1 - ramp(p, .5, .7));
      A.handle = (v.handleOpen || 1.15) * up; A.bolt = (v.boltTravel || .1) * back;
      A.rz += .14 * hold(p, 0, 1, .15); A.rx += -.04 * bump(p, .1, .9); A.x += .015 * bump(p, .1, .9);
      A.dR.copy(this._handleTarget(v)).multiplyScalar(hold(p, 0, 1, .12)).add(this._v.set(0, 0, .1 * back));
      A.noAds = .55 * hold(p, 0, 1, .12);
    } else if (act.name === 'pump') { // 펌프액션: 왼손이 펌프를 당겼다 민다
      const pull = bump(p, .25, .85) ** .7; A.pump = (v.pumpTravel || .1) * pull; A.dL.set(0, 0, (v.pumpTravel || .1) * pull);
      A.rx += -.05 * bump(p, .2, .9); A.y += -.008 * bump(p, .2, .9);
    } else if (act.name === 'inspect') { // 무기 점검: 옆면을 보여 주고 반대로 기울인 뒤 복귀
      const a = hold(p, 0, .55, .18), b = hold(p, .45, 1, .18);
      A.ry += .75 * a - .25 * b; A.rz += .55 * a - .45 * b; A.rx += .15 * a + .2 * b; A.x += -.05 * a; A.y += .03 * a + .02 * b; A.z += .08 * a;
      if (id === 'springfield' || id === 'garand') A.bolt = (v.boltTravel || .06) * .5 * bump(p, .6, .85);
      if (id === 'springfield') A.handle = (v.handleOpen || 1.15) * bump(p, .55, .9);
      if (id === 'thompson') { A.magY = -.03 * bump(p, .6, .75); }
      A.noAds = 1;
    }
    return A;
  }
  _handleTarget(v) { // 오른손이 볼트 손잡이로 가는 이동량(총 좌표)
    if (!v.parts.handle) return this._v.set(.06, .08, -.06).clone();
    const w = v.parts.handle.getWorldPosition(new V3()); v.g.worldToLocal(w);
    return w.sub(v.gripR).add(new V3(.03, 0, .02));
  }

  // ------------------------------------------------------------- 손
  _makeHand(g, grip, shoulder) {
    const VM = this.VM, h = { group: new THREE.Group(), shoulder: shoulder.clone() };
    const palm = new THREE.Mesh(this._unitSph, VM.skin); palm.scale.set(.07, .055, .1); h.group.add(palm);
    h.arm = new THREE.Mesh(this._armGeo, VM.sleeve);
    for (const m of [palm, h.arm]) m.userData.hand = true;
    g.add(h.group, h.arm); this._placeHand(h, grip);
    return h;
  }
  _placeHand(h, pos) {
    h.group.position.copy(pos);
    const d = this._hd.copy(h.shoulder).sub(pos), L = d.length(); d.normalize();
    h.arm.position.copy(pos).addScaledVector(d, .02); h.arm.quaternion.setFromUnitVectors(this._up, d); h.arm.scale.set(1, L, 1);
  }
  _rig(v, gripR, gripL, shR = new V3(.2, -.4, .4), shL = new V3(-.3, -.42, .06)) {
    v.gripR = gripR; v.gripL = gripL;
    v.hands = { R: this._makeHand(v.g, gripR, shR), L: this._makeHand(v.g, gripL, shL) };
  }

  // ------------------------------------------------------------- 1인칭 파편 (탄피·클립)
  _casingMesh(kind) {
    if (kind === 'shell') { const g = new THREE.Group(), hull = new THREE.Mesh(new THREE.CylinderGeometry(.0105, .0105, .06, 10), new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: .6 })), base = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .014, 10), this.brassMat); base.position.y = -.026; g.add(hull, base); return g; }
    return new THREE.Mesh(new THREE.CylinderGeometry(.0055, .006, .063, 8), this.brassMat);
  }
  _clipMesh(empty) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x55575a, metalness: .85, roughness: .35 });
    const side = new THREE.Mesh(new THREE.BoxGeometry(.003, .018, .062), m); side.position.x = -.017; const side2 = side.clone(); side2.position.x = .017;
    const back = new THREE.Mesh(new THREE.BoxGeometry(.036, .016, .004), m); back.position.z = .03; g.add(side, side2, back);
    if (!empty) for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .006, .063, 8), this.brassMat); r.rotation.x = PI / 2; r.position.set((i % 2 ? .0055 : -.0055), .008 + (i % 2) * .002, 0); g.add(r); }
    return g;
  }
  _spawnDebris(mesh, localPos, vel, life) {
    const v = this.view; v.g.updateMatrixWorld(true);
    mesh.position.copy(localPos).applyMatrix4(v.g.matrixWorld);
    const w = vel.clone().transformDirection(this.root.matrixWorld).multiplyScalar(vel.length());
    this.vmScene.add(mesh); this.debris.push({ mesh, vel: w, spin: new V3(rand(-14, 14), rand(-14, 14), rand(-14, 14)), life });
  }
  _updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.life -= dt; d.vel.y -= 6 * dt; d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.life <= 0) { this.vmScene.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------- GLB 교체
  _dress(v) {
    const key = `weapons.${v.id}`, model = this.assets.instantiate(key, { anchor: 'origin' });
    if (!model) { v.source = 'procedural'; return; }
    const spec = this.assets.spec(key) || {};
    v.g.traverse((o) => { if (o.isMesh && !o.userData.hand) o.visible = false; });
    v.roundProc && (v.roundProc.visible = false); v.parts = {};   // 절차적 부품은 숨겨졌으므로 GLB 노드로 다시 연결한다
    if (spec.position) model.position.set(...spec.position);
    if (spec.rotation) model.rotation.set(...spec.rotation.map((d) => THREE.MathUtils.degToRad(d)));
    v.g.add(model); v.model = model; v.source = 'glb';
    const find = (name) => { let hit = null; model.traverse((o) => { if (!hit && o.name === name) hit = o; }); return hit; };
    // 재질 이름 → 게임 재질(실사 나무·강철 텍스처). 텍스처 없는 저폴리 모델에 질감을 입힌다
    if (spec.materials) model.traverse((o) => { if (!o.isMesh) return; const swap = (m) => (m && spec.materials[m.name] && this.VM[spec.materials[m.name]]) || m; o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
    for (const n of spec.hide || []) { const o = find(n); if (o) o.visible = false; }
    v.partStatus = {};
    for (const [part, node] of Object.entries(spec.parts || {})) { const o = find(node); v.partStatus[part] = !!o; if (o) v.parts[part] = o; }
    // 부품이 GLB 안에서 회전된 좌표계에 있으므로, 이동 축을 총 좌표(−Z 앞)에서 부품의 부모 좌표로 바꿔 둔다
    const axisIn = (o, axis) => { v.g.updateMatrixWorld(true); const m = new THREE.Matrix3().setFromMatrix4(o.parent.matrixWorld).invert().multiply(new THREE.Matrix3().setFromMatrix4(v.g.matrixWorld)); return axis.clone().applyMatrix3(m).normalize(); };
    if (v.parts.bolt) v.boltAxis = axisIn(v.parts.bolt, new V3(0, 0, 1));
    if (v.parts.handle) {   // 손잡이 회전축은 손잡이 자신의 좌표계, 노리쇠를 따라 움직이는 축은 부모 좌표계
      v.g.updateMatrixWorld(true); const h = v.parts.handle;
      v.handleAxis = new V3(0, 0, 1).applyMatrix3(new THREE.Matrix3().setFromMatrix4(h.matrixWorld).invert().multiply(new THREE.Matrix3().setFromMatrix4(v.g.matrixWorld))).normalize();
      let inBolt = false; for (let o = h.parent; o; o = o.parent) if (o === v.parts.bolt) inBolt = true;
      if (!inBolt && v.parts.bolt) v.handleFollow = axisIn(h, new V3(0, 0, 1)).multiplyScalar(1);
    }
    for (const [part, p] of Object.entries(spec.partAt || {})) { const o = v.parts[part]; if (!o) continue; v.g.updateMatrixWorld(true); o.position.copy(o.parent.worldToLocal(v.g.localToWorld(new V3(...p)))); }
    if (spec.clipLoaded) v.clipLoaded = true;   // 장전된 동안 클립이 총 안에 보이는 모델
    for (const k of ['boltTravel', 'pumpTravel', 'handleOpen', 'adsY', 'adsZ']) if (spec[k] !== undefined) v[k] = spec[k];
    if (spec.gripR) v.gripR.set(...spec.gripR); if (spec.gripL) v.gripL.set(...spec.gripL);
    if (spec.ejectPort) v.ejectPort = new V3(...spec.ejectPort);
    let muzzle = null; model.traverse((o) => { if (!muzzle && /^muzzle$/i.test(o.name)) muzzle = o; });
    if (spec.muzzle) v.muzzle.set(...spec.muzzle);
    else if (muzzle) { model.updateMatrixWorld(true); v.g.updateMatrixWorld(true); v.muzzle.copy(v.g.worldToLocal(muzzle.getWorldPosition(new V3()))); }
    // 손에 드는 탄·클립은 GLB 에 없으면 절차적 소품을 쓴다
    if (!v.parts.round && v.roundProc) { v.parts.round = v.roundProc; v.roundProc.visible = false; }
    if (!v.parts.clip && v.clipProc) { v.parts.clip = v.clipProc; }
    if (v.parts.round) v.parts.round.visible = false;
    // 무료로 구할 수 있는 스코프 모델이 없어, 스코프는 코드로 만든 것을 모델 위에 얹는다
    if (spec.attachScope) { const sc = this._scopeGroup(); sc.position.set(...spec.attachScope); v.g.add(sc); v.scope = sc; }
  }
  _captureRest(v) {
    const P = v.parts; v.rest = {};
    for (const k of ['bolt', 'pump', 'mag', 'clip', 'round', 'handle']) if (P[k]) v.rest[k] = P[k].position.clone();
    if (P.handle) v.rest.handleRot = P.handle.rotation.clone();
    if (P.mag) v.rest.magRot = P.mag.rotation.clone();
  }

  // ------------------------------------------------------------- 절차적 총기 (GLB 가 없을 때의 대체 모델)
  _box(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(unitBox, mat); m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m; }
  _prof(pts, thick, mat, parent, bevel = .006) { // 옆모습 윤곽 [앞, 위] 을 두께만큼 돌출
    const sh = new THREE.Shape(); pts.forEach(([f, y], i) => (i ? sh.lineTo(f, y) : sh.moveTo(f, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, steps: 1 });
    geo.translate(0, 0, -(thick - bevel * 2) / 2); geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); parent.add(m); return m;
  }
  _tube(r, len, mat, parent, f0, y, x = 0, seg = 14) { // 총열 방향 원통, 손잡이에서 f0 미터 앞에서 시작
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, -(f0 + len / 2)); parent.add(m); return m;
  }
  /** Weaver 330C 형태의 망원조준경(가는 몸통·대물렌즈·접안부·터렛·링 마운트). 원점 = 뒤쪽 링 아래 */
  _scopeGroup() {
    const VM = this.VM, g = new THREE.Group(), t = (r, len, z, y = 0, seg = 18) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), VM.dark); m.rotation.x = PI / 2; m.position.set(0, y, z); g.add(m); return m; };
    const lathe = (pts, z) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24), VM.dark); m.rotation.x = -PI / 2; m.position.z = z; g.add(m); return m; };
    const Y = .05;
    t(.0095, .30, -.07, Y);                                                     // 몸통 (3/4인치)
    lathe([[.0095, 0], [.0105, .01], [.0155, .045], [.0155, .075], [.0145, .08]], -.22).position.y = Y;   // 대물렌즈 쪽 (앞)
    lathe([[.0145, 0], [.0155, .006], [.0155, .05], [.0105, .075], [.0095, .085]], .055).position.y = Y;   // 접안부 (뒤)
    const glass = new THREE.Mesh(new THREE.CircleGeometry(.013, 20), new THREE.MeshStandardMaterial({ color: 0x223040, metalness: .2, roughness: .05, envMapIntensity: 2 })); glass.position.set(0, Y, -.302); glass.rotation.y = PI; g.add(glass);
    const turret = (x, y, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(.0085, .0085, .016, 14), VM.dark); m.position.set(x, Y + y, -.07); m.rotation.set(rx, 0, rz); g.add(m); const c = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .004, 14), VM.steel); c.position.copy(m.position); c.position.y += y ? .009 : 0; c.position.x += x ? .009 : 0; c.rotation.copy(m.rotation); g.add(c); };
    const base = new THREE.Mesh(new THREE.BoxGeometry(.022, .014, .03), VM.dark); base.position.set(0, Y, -.07); g.add(base);
    turret(0, .014, 0, 0); turret(.014, 0, 0, PI / 2);
    for (const z of [0, -.13]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.0112, .0028, 8, 20), VM.steel); ring.position.set(0, Y, z); g.add(ring); const post = new THREE.Mesh(new THREE.BoxGeometry(.012, Y - .006, .012), VM.steel); post.position.set(0, (Y - .006) / 2, z); g.add(post); const foot = new THREE.Mesh(new THREE.BoxGeometry(.026, .006, .03), VM.steel); foot.position.set(0, .0, z); g.add(foot); }
    g.traverse((o) => { if (o.isMesh) o.userData.scope = true; });
    return g;
  }
  _guard(g, z) { const VM = this.VM; this._box(.01, .005, .085, VM.dark, 0, -.082, z, g); this._box(.01, .03, .005, VM.dark, 0, -.068, z - .04, g); this._box(.006, .022, .006, VM.dark, 0, -.062, z - .005, g).rotation.x = .3; }
  _round(g) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .006, .063, 8), this.brassMat); r.rotation.x = PI / 2; r.visible = false; g.add(r); return r; }
  _garand() { const VM = this.VM, g = new THREE.Group(), box = (...a) => this._box(...a, g), prof = (...a) => this._prof(...a);
    prof([[-.44, -.13], [-.44, -.02], [-.2, .008], [-.1, .02], [0, .012], [.56, .012], [.56, -.03], [.14, -.045], [.02, -.055], [-.08, -.045], [-.16, -.07], [-.3, -.105]], .05, VM.wood, g, .009);
    prof([[.17, .014], [.17, .046], [.52, .04], [.52, .014]], .038, VM.wood, g, .007);
    prof([[-.13, .012], [-.13, .05], [-.1, .06], [.15, .06], [.17, .046], [.17, .012]], .046, VM.steel, g, .004);
    box(.03, .004, .12, VM.dark, 0, .063, -.02);
    this._tube(.011, .5, VM.steel, g, .5, .036); this._tube(.0125, .4, VM.dark, g, .56, .011); box(.034, .05, .02, VM.dark, 0, .025, -.55); box(.03, .045, .02, VM.dark, 0, .025, -.95);
    box(.03, .012, .03, VM.dark, 0, .053, -.97); box(.004, .03, .01, VM.dark, 0, .072, -.97); box(.004, .022, .014, VM.dark, -.013, .068, -.97); box(.004, .022, .014, VM.dark, .013, .068, -.97);
    box(.036, .012, .03, VM.dark, 0, .064, .09); box(.006, .024, .008, VM.dark, -.011, .08, .09); box(.006, .024, .008, VM.dark, .011, .08, .09); box(.028, .005, .008, VM.dark, 0, .094, .09);
    const bolt = box(.022, .012, .03, VM.steel, .034, .046, -.06); this._guard(g, .03);
    const clip = this._clipMesh(false); clip.position.set(0, .06, .0); clip.visible = false; g.add(clip);
    const v = { g, muzzle: new V3(0, .036, -1.05), parts: { bolt, clip }, clipProc: clip, clipPos: new V3(0, .07, 0), ejectPort: new V3(.03, .06, -.02), boltTravel: .05 };
    this._rig(v, new V3(.012, -.055, .13), new V3(-.012, -.05, -.32)); return v; }
  _thompson() { const VM = this.VM, g = new THREE.Group(), box = (...a) => this._box(...a, g), prof = (...a) => this._prof(...a);
    prof([[-.2, 0], [-.2, .062], [.2, .062], [.22, .05], [.22, 0]], .05, VM.steel, g, .004);
    prof([[-.2, -.03], [-.2, 0], [.13, 0], [.13, -.03]], .042, VM.dark, g, .003);
    this._tube(.013, .28, VM.steel, g, .22, .035); this._tube(.017, .03, VM.dark, g, .22, .035); box(.006, .03, .008, VM.dark, 0, .064, -.485); box(.02, .01, .02, VM.dark, 0, .05, -.485);
    prof([[.2, -.036], [.2, .012], [.42, .012], [.42, -.02], [.38, -.036]], .05, VM.wood, g, .009);
    prof([[-.1, 0], [-.04, 0], [-.08, -.13], [-.15, -.13]], .04, VM.wood, g, .009);
    prof([[-.56, -.15], [-.56, -.035], [-.2, .03], [-.2, -.03], [-.3, -.065]], .045, VM.wood, g, .009);
    const mag = box(.03, .27, .046, VM.dark, 0, -.16, -.085); mag.rotation.x = -.04;
    box(.034, .01, .03, VM.dark, 0, .067, .17); box(.007, .022, .008, VM.dark, -.012, .08, .17); box(.007, .022, .008, VM.dark, .012, .08, .17);
    const bolt = box(.026, .012, .014, VM.steel, .036, .046, -.06); this._guard(g, .0);
    const v = { g, muzzle: new V3(0, .035, -.52), parts: { bolt, mag }, ejectPort: new V3(.03, .05, -.06), boltTravel: .05 };
    this._rig(v, new V3(.012, -.075, .085), new V3(-.012, -.05, -.31)); return v; }
  _trench() { const VM = this.VM, g = new THREE.Group(), box = (...a) => this._box(...a, g), prof = (...a) => this._prof(...a);
    prof([[-.14, -.035], [-.14, .03], [-.1, .05], [.14, .05], [.14, -.035]], .046, VM.steel, g, .004);
    this._tube(.0135, .64, VM.steel, g, .14, .032); this._tube(.019, .4, VM.dark, g, .3, .032, 0, 12); this._tube(.012, .5, VM.steel, g, .14, .002); box(.03, .05, .016, VM.dark, 0, .018, -.66);
    const pump = this._tube(.026, .17, VM.wood, g, .3, .002, 0, 12);
    prof([[-.52, -.15], [-.52, -.04], [-.2, .02], [-.14, .03], [-.14, -.035], [-.2, -.07], [-.3, -.105]], .046, VM.wood, g, .009);
    box(.006, .012, .006, VM.dark, 0, .058, -.76); this._guard(g, .08);
    const round = this._casingMesh('shell'); round.rotation.x = PI / 2; round.position.set(0, -.04, -.06); round.visible = false; g.add(round);
    const v = { g, muzzle: new V3(0, .032, -.82), parts: { pump, round }, roundProc: round, ejectPort: new V3(.03, .04, -.02), pumpTravel: .1 };
    this._rig(v, new V3(.012, -.05, .2), new V3(-.012, -.045, -.385)); return v; }
  _springfield() { const VM = this.VM, g = new THREE.Group(), box = (...a) => this._box(...a, g), prof = (...a) => this._prof(...a);
    prof([[-.45, -.13], [-.45, -.02], [-.2, .006], [-.1, .016], [0, .01], [.6, .01], [.62, -.02], [.14, -.04], [.02, -.05], [-.08, -.044], [-.16, -.07], [-.3, -.105]], .048, VM.wood, g, .009);
    this._tube(.012, .32, VM.steel, g, .02, .03); this._tube(.0105, .55, VM.steel, g, .5, .032);
    box(.03, .045, .02, VM.dark, 0, .025, -.62); box(.004, .02, .01, VM.dark, 0, .052, -1.02);
    // 노리쇠와 손잡이
    const bolt = new THREE.Group(); bolt.position.set(0, .03, -.02); g.add(bolt);
    const bb = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .14, 12), VM.steel); bb.rotation.x = PI / 2; bolt.add(bb);
    const handle = new THREE.Group(); handle.position.set(0, 0, .05); bolt.add(handle);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .06, 8), VM.steel); stem.rotation.z = PI / 2; stem.position.x = .03; handle.add(stem);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.009, 10, 8), VM.steel); knob.position.x = .06; handle.add(knob);
    // 망원조준경 (Weaver 330C 형태: 가는 몸통 + 링 마운트 + 터렛)
    const tube = this._tube(.011, .30, VM.dark, g, -.06, .085); void tube;
    this._tube(.016, .06, VM.dark, g, -.12, .085); this._tube(.017, .05, VM.dark, g, .24, .085);
    box(.024, .022, .022, VM.dark, 0, .085, -.11); box(.012, .016, .012, VM.dark, 0, .102, -.11); box(.016, .012, .012, VM.dark, .018, .085, -.11);
    for (const z of [-.02, -.2]) { box(.03, .05, .016, VM.steel, 0, .058, z); }
    this._guard(g, .04);
    const round = this._round(g); round.position.set(.0, .05, -.02);
    const v = { g, muzzle: new V3(0, .032, -1.06), parts: { bolt, handle, round }, roundProc: round, ejectPort: new V3(.03, .05, -.03), boltTravel: .1, handleOpen: 1.15, adsY: -.15, adsZ: -.24 };
    this._rig(v, new V3(.012, -.055, .13), new V3(-.012, -.05, -.34)); return v; }
}
