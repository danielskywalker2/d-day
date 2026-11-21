// CharacterManager — 병사(독일군·미군)의 겉모습, 피격 부위, 골격 애니메이션.
//
// 피격 부위: 절차적 병사의 머리/몸통/다리 메시에 userData { enemy, part } 를 단다. GLB 모델을 쓰면 이 메시들은
// 숨기기만 하고(레이캐스트에는 계속 걸림) 판정과 헤드샷 배율은 그대로 유지된다.
//
// 골격 애니메이션: 슬롯 characters.german / characters.american 의 GLB 에 애니메이션 클립이 있으면
// SoldierAnimator 가 THREE.AnimationMixer 로 재생한다. AI 는 상태만 알려 주고(속도·웅크림·조준·사격·재장전·피격·사망)
// 전환은 여기서 크로스페이드로 부드럽게 처리한다. 철모·군장·총은 뼈에 붙인다.
import * as THREE from 'three';
import { unitBox } from '../core/utils.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;

// ------------------------------------------------------------------ 애니메이터
/** 클립 이름(빌드 도구에서 정한 이름) → 이동 속도(m/s, 재생 속도 맞춤용) */
const LOCO = { Idle: 0, AimIdle: 0, CrouchIdle: 0, Walk: 1.35, CrouchWalk: 1.1, Run: 3.3, Sprint: 5.6 };

export class SoldierAnimator {
  constructor(model, clips) {
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
    for (const n of ['Shoot', 'Reload', 'HitChest', 'HitHead', 'Death']) { const a = this.actions[n]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    this.base = null; this.oneShot = null; this.oneT = 0; this.dead = false; this.pitch = 0;
    this.spine = model.getObjectByName('spine_03'); this.spine2 = model.getObjectByName('spine_02');
    this.model = model; this.head = model.getObjectByName('Head'); this.pelvis = model.getObjectByName('pelvis');
    // 6단계 피격 반동: 클립 위에 덧붙이는 스프링(상체 뒤로 젖힘·옆으로 비틂·머리 꺾임·골반 주저앉음)
    this.rx = { lean: 0, side: 0, head: 0, drop: 0 }; this.rv = { lean: 0, side: 0, head: 0, drop: 0 };
    this.deathYaw = null;
    this.setBase('AimIdle', 0);
    this.mixer.update(Math.random() * 2);   // 병사마다 동작이 어긋나도록
  }
  has(n) { return !!this.actions[n]; }
  setBase(name, fade = .25) {
    if (!this.has(name)) name = 'Idle';
    const next = this.actions[name]; if (!next || this.base === next) return;
    // 주의: setEffectiveWeight(0) 은 가중치를 영구히 0 으로 만들어 이후 fadeIn 이 듣지 않는다 → 숨길 때는 enabled 를 끈다
    next.reset(); next.setEffectiveWeight(1); next.play();
    if (this.oneShot) { next.enabled = false; if (this.base) this.base.stop(); }   // 단발 동작이 끝나면 페이드인
    else if (this.base) next.crossFadeFrom(this.base, fade, false);
    this.base = next; this.baseName = name;
  }
  /** 한 번만 재생하는 동작(사격·재장전·피격). 끝나면 원래 동작으로 부드럽게 돌아간다 */
  playOnce(name, fadeIn = .06, speed = 1) {
    const a = this.actions[name]; if (!a || this.dead) return 0;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(fadeIn);
    a.enabled = true; a.reset(); a.timeScale = speed; a.setEffectiveWeight(1); a.play();
    if (this.base) this.base.fadeOut(fadeIn);
    a.fadeIn(fadeIn);
    this.oneShot = a; this.oneT = a.getClip().duration / speed;
    return this.oneT;
  }
  fire() { if (!this.oneShot || this.oneShot.getClip().name === 'Shoot') this.playOnce('Shoot', .04, 1.4); }
  reload() { return this.playOnce('Reload', .12); }
  /** 피격: 부위별 클립 + 맞은 방향으로 밀리는 반동. dir = 탄의 진행 방향(월드), knock = 무기 충격량 */
  hit(part, dir, knock = 4) {
    if (this.dead) return;
    this.playOnce(part === 'head' ? 'HitHead' : 'HitChest', .05, part === 'leg' ? .85 : 1.2);
    this._kick(part, dir, knock);
  }
  _kick(part, dir, knock) {
    const k = THREE.MathUtils.clamp(knock / 6, .35, 1.4), l = this._local(dir), v = this.rv;
    if (part === 'head') { v.head -= 9 * k; v.lean -= 3 * k * l.z; }
    else if (part === 'leg') { v.drop += 2.2 * k; v.lean += 2 * k; }
    else { v.lean -= 7 * k * l.z; v.side += 6 * k * l.x; }
  }
  /** 월드 방향 → 모델 기준(앞 +Z, 오른쪽 +X) */
  _local(dir) { const q = this._q || (this._q = new THREE.Quaternion()), o = this._lv || (this._lv = new V()); if (!dir) return o.set(0, 0, -1); this.model.getWorldQuaternion(q); return o.copy(dir).applyQuaternion(q.invert()).setY(0).normalize(); }
  die(dir, knock = 4) {
    if (this.dead) return; this.dead = true;
    // 쓰러지는 방향: 사망 동작은 뒤(-Z)로 넘어진다 → 탄이 날아온 반대쪽으로 쓰러지게 몸을 돌린다(정면 ±60°까지)
    if (dir) { const l = this._local(dir); const a = Math.atan2(l.x, -l.z); this.deathYaw = { from: this.model.rotation.y, to: this.model.rotation.y + THREE.MathUtils.clamp(a, -1.05, 1.05) * .8, t: 0 }; this._kick('body', dir, knock * 1.4); }
    const d = this.actions.Death; if (!d) return;
    for (const a of Object.values(this.actions)) if (a !== d && a.isRunning()) a.fadeOut(.15);
    d.enabled = true; d.reset(); d.setEffectiveWeight(1); d.fadeIn(.15); d.play(); this.oneShot = null;
  }
  /**
   * @param {number} dt
   * @param {{speed:number, crouch:boolean, aiming:boolean, pitch:number}} s
   */
  update(dt, s) {
    // 7단계 LOD: 먼 병사는 2~3 프레임에 한 번만 골격을 계산한다(시간은 모아서 한 번에 진행 → 동작 속도는 같음)
    this._acc = (this._acc || 0) + dt;
    if (this.skip && ((this._f = (this._f || 0) + 1) % (this.skip + 1))) return;
    dt = this._acc; this._acc = 0;
    if (!this.dead) {
      let name;
      if (s.crouch) name = s.speed > .3 ? 'CrouchWalk' : 'CrouchIdle';
      else if (s.speed < .3) name = s.aiming ? 'AimIdle' : 'Idle';
      else if (s.speed < 2.2) name = 'Walk';
      else if (s.speed < 4.6) name = 'Run';
      else name = 'Sprint';
      this.setBase(name);
      const ref = LOCO[name]; if (ref) this.base.timeScale = THREE.MathUtils.clamp(s.speed / ref, .6, 1.5); else if (this.base) this.base.timeScale = 1;
      if (this.oneShot) { this.oneT -= dt; if (this.oneT <= .12) { this.oneShot.fadeOut(.15); const b = this.base; b.enabled = true; b.setEffectiveWeight(1); b.play(); b.fadeIn(.15); this.oneShot = null; } }
      this.pitch += ((s.aiming ? s.pitch : 0) - this.pitch) * Math.min(1, dt * 6);
    }
    this.mixer.update(dt);
    // 조준 높이: 상체를 목표 쪽으로 숙이거나 든다(애니메이션 위에 덧붙임)
    if (!this.dead && this.spine && Math.abs(this.pitch) > .001) { this.spine.rotateX(-this.pitch * .55); if (this.spine2) this.spine2.rotateX(-this.pitch * .35); }
    // 피격 반동 스프링 (빠르게 튀고 0.3초 안에 가라앉음)
    const x = this.rx, v = this.rv, h = Math.min(dt, .05);
    let any = false;
    for (const k in x) { v[k] += (-170 * x[k] - 17 * v[k]) * h; x[k] += v[k] * h; if (Math.abs(x[k]) > .002 || Math.abs(v[k]) > .02) any = true; else { x[k] = 0; v[k] = 0; } }
    if (any && this.spine) { this.spine.rotateX(x.lean * .6); this.spine.rotateZ(x.side * .5); if (this.spine2) this.spine2.rotateX(x.lean * .4); if (this.head) this.head.rotateX(x.head * .8); if (this.pelvis) this.pelvis.position.y -= x.drop * .12; }
    if (this.deathYaw) { const d = this.deathYaw; d.t = Math.min(1, d.t + dt / .35); this.model.rotation.y = d.from + (d.to - d.from) * (1 - (1 - d.t) ** 2); if (d.t >= 1) this.deathYaw = null; }
  }
}

// ------------------------------------------------------------------ 매니저
export class CharacterManager {
  constructor({ renderer, assets, materials }) {
    this.scene = renderer.scene; this.assets = assets; this.M = materials.M; this.VM = materials.VM;
    this.geo = { cyl: new THREE.CylinderGeometry(.5, .5, 1, 10), sph: new THREE.SphereGeometry(.5, 14, 10), torso: new THREE.CylinderGeometry(.5, .4, 1, 12), helm: new THREE.SphereGeometry(.5, 14, 8, 0, 6.2832, 0, 1.72) };
    const M = this.M;
    this.kits = {
      german: { uniform: M.feld, pants: M.feldDark, shin: M.boots, belt: M.boots, helmet: M.helmet, german: true },
      american: { uniform: M.od, pants: M.odDark, shin: M.canvas, belt: M.canvas, helmet: M.helmetUS, german: false },
    };
    this.count = { procedural: 0, model: 0, animated: 0 };
    this.animators = new Set();
    this._rig = {};   // 진영별: 손에 총을 쥐는 자세·철모 위치(뼈 기준) 캐시
  }

  /**
   * owner 에 group / body / legL / legR / meshes(피격 부위) 를 채우고 장면에 추가한다.
   * GLB 에 애니메이션이 있으면 owner.anim (SoldierAnimator) 도 만든다.
   * @param {{gunLen?: number, mag?: boolean, hitZones?: boolean, weapon?: 'rifle'|'smg'|'garand'}} opts
   */
  /** look: 'ffi'(레지스탕스: 사복 색·베레모·완장) | 'civilian'(민간인: 사복 색, 장비·총 없음) · tint: 옷 색 곱하기 [r,g,b] */
  create(owner, faction, { gunLen = .78, mag = false, hitZones = false, weapon = 'rifle', look = null, tint = null } = {}) {
    const K = { ...this.kits[faction], gunLen, mag }, M = this.M, G = this.geo;
    owner.meshes = owner.meshes || [];
    const g = owner.group = new THREE.Group(), b = owner.body = new THREE.Group(); g.add(b);
    const P = (n) => (hitZones ? n : undefined);
    const limb = (w, h, d, mat, x, y, z, parent, part, geo) => { const m = new THREE.Mesh(geo || unitBox, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; parent.add(m); if (part) { m.userData = { enemy: owner, part }; owner.meshes.push(m); } return m; };
    owner.legL = new THREE.Group(); owner.legR = new THREE.Group(); owner.legL.position.set(-.11, .84, 0); owner.legR.position.set(.11, .84, 0); b.add(owner.legL, owner.legR);
    for (const L of [owner.legL, owner.legR]) { limb(.2, .46, .22, K.pants, 0, -.2, 0, L, P('leg'), G.cyl); limb(.16, .4, .18, K.shin, 0, -.58, 0, L, P('leg'), G.cyl); limb(.15, .11, .29, M.boots, 0, -.785, .045, L, P('leg')); }
    limb(.45, .2, .28, K.pants, 0, .88, 0, b, P('body'), G.cyl);
    limb(.5, .58, .3, K.uniform, 0, 1.15, 0, b, P('body'), G.torso);
    limb(.58, .16, .27, K.uniform, 0, 1.38, 0, b, P('body'), G.sph);
    limb(.47, .06, .31, K.belt, 0, .97, 0, b, 0, G.cyl);
    limb(.08, .09, .05, K.belt, -.12, .98, .14, b); limb(.08, .09, .05, K.belt, .12, .98, .14, b);
    limb(.05, .5, .31, K.belt, -.13, 1.2, 0, b).rotation.z = .12; limb(.05, .5, .31, K.belt, .13, 1.2, 0, b).rotation.z = -.12;
    limb(.11, .1, .11, M.skin, 0, 1.47, 0, b, P('head'), G.cyl);
    limb(.2, .25, .22, M.skin, 0, 1.6, 0, b, P('head'), G.sph);
    limb(.03, .035, .03, M.skin, 0, 1.585, .115, b);
    limb(.28, .3, .32, K.helmet, 0, 1.62, -.01, b, P('head'), G.helm);
    if (K.german) { limb(.33, .09, .36, K.helmet, 0, 1.6, -.045, b, P('head'), G.cyl); limb(.13, .3, .13, K.pants, 0, 1.0, -.19, b, 0, G.cyl).rotation.z = 1.57; }
    else { limb(.3, .025, .34, K.helmet, 0, 1.635, 0, b, 0, G.cyl); limb(.34, .38, .15, K.pants, 0, 1.2, -.2, b); limb(.12, .16, .08, K.shin, .2, .93, -.12, b, 0, G.cyl); }
    const aL = limb(.12, .5, .12, K.uniform, -.24, 1.24, .2, b, P('body'), G.cyl), aR = limb(.12, .46, .12, K.uniform, .27, 1.2, .13, b, P('body'), G.cyl); aL.rotation.set(-1.15, 0, -.45); aR.rotation.set(-.85, 0, .22);
    limb(.08, .08, .09, M.skin, .09, 1.25, .46, b, 0, G.sph); limb(.08, .08, .09, M.skin, .14, 1.2, .2, b, 0, G.sph);
    limb(.045, .09, .46, M.woodDark, .1, 1.26, .14, b); limb(.045, .055, .3, M.woodDark, .1, 1.285, .5, b);
    limb(.03, K.gunLen, .03, M.gun, .1, 1.3, .3 + K.gunLen / 2, b, 0, G.cyl).rotation.x = 1.5708;
    if (K.mag) limb(.03, .2, .04, M.gun, .1, 1.17, .42, b);

    const key = `characters.${faction}`, model = this.assets.instantiate(key, { fit: [5, 1.8, 5] });
    if (model) {
      b.traverse((o) => { if (o.isMesh) o.visible = false; });
      g.add(model); owner.model = model; this.count.model++;   // 몸통 그룹이 아니라 그룹에 붙인다(쓰러짐은 애니메이션이 맡음)
      const clips = model.userData.animations || [];
      // 7단계: 화면 밖 병사는 그리지 않는다(골격 메시는 바인드 자세 기준 경계가 부정확하므로, 쓰러진 자세까지 덮는 구를 직접 준다)
      this._shrinkMaps(model, faction);
      if (look) this._recolor(model, look, tint);
      g.updateMatrixWorld(true); const faces = [];
      model.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = true;
        if (o.isSkinnedMesh) { const sc = o.getWorldScale(new V()).x || 1; o.boundingSphere = new THREE.Sphere(o.worldToLocal(new V(0, .8, 0)), 2.1 / sc); }
        if (/Eyes|Eyebrows/.test(o.name)) faces.push(o);
        if (/Eyes|Eyebrows|Feet|Arms_1/.test(o.name)) o.castShadow = false; });   // 작은 부품은 그림자 패스에서 뺀다(모양 차이 거의 없음)
      owner.lodFaces = faces;
      this._equip(model, faction, weapon, look);
      owner.lodGear = []; model.traverse((o) => { if (o.userData.lodGear) owner.lodGear.push(o); });
      const blob = this._blob(); g.add(blob); owner.lodGear.push(blob);   // 발밑 접지 그림자
      if (clips.length) { owner.anim = new SoldierAnimator(model.children[0], clips); this.animators.add(owner.anim); this.count.animated++; }
    } else this.count.procedural++;
    g.position.set(owner.x, owner.y, owner.z); g.rotation.y = owner.yaw; this.scene.add(g);
    return owner;
  }
  _blob() {
    if (!this._blobMat) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); this._blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }); this._blobGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2); }
    const m = new THREE.Mesh(this._blobGeo, this._blobMat); m.position.y = .03; m.renderOrder = -1; return m;
  }
  /** 시체 정리 등으로 병사를 장면에서 뺀다. */
  release(owner) { this.scene.remove(owner.group); if (owner.anim) { owner.anim.mixer.stopAllAction(); this.animators.delete(owner.anim); owner.anim = null; } }

  // ---------------------------------------------------------------- 장비
  /** 총을 오른손에, 철모를 머리에, 탄띠·배낭 등을 몸통 뼈에 붙인다. */
  _equip(model, faction, weapon, look = null) {
    const bone = (n) => model.getObjectByName(n);
    const hand = bone('hand_r'), head = bone('Head'), pelvis = bone('pelvis'), chest = bone('spine_03');
    if (!hand || !head) return;
    const rig = this._rig[faction] || (this._rig[faction] = this._measure(model));
    if (look === 'civilian') return;   // 민간인: 총·철모·군장 없음
    if (look === 'ffi') {              // 레지스탕스(FFI): 총 + 베레모 + 흰 완장(군장·철모 없음)
      const put = (o, t, parent) => { o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); parent.add(o); };
      const gk = weapon === 'smg' ? 'thompson' : 'garand';
      put(this._merged('gun:' + gk, () => this._gun(gk), true), rig.gun, hand);
      put(this._merged('beret', () => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 8), new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 1 })); m.scale.set(1.15, .38, 1.15); m.position.set(.02, -.07, -.01); m.rotation.z = -.25; g.add(m); return g; }, true), rig.head, head);
      const arm = bone('upperarm_l');
      if (arm) { const sc = arm.getWorldScale(new V()).x || 1, band = new THREE.Mesh(new THREE.CylinderGeometry(.068 / sc, .068 / sc, .08 / sc, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8e6dc, side: THREE.DoubleSide, roughness: 1 })); band.rotation.z = Math.PI / 2; band.position.set(.13 / sc, 0, 0); arm.add(band); }
      return;
    }
    const de = faction === 'german', M = this.M;
    // 총: 조준 자세에서 팔 방향으로 총열이 향하도록 미리 잰 회전을 쓴다
    const gunKind = de ? (weapon === 'smg' ? 'mp40' : 'kar98k') : weapon === 'smg' ? 'thompson' : 'garand';
    const put = (o, t, parent) => { o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); parent.add(o); };
    put(this._merged(`gun:${gunKind}`, () => this._gun(gunKind), true), rig.gun, hand);
    // 철모
    put(this._merged(`helm:${faction}`, () => (de ? this._stahlhelm() : this._m1helmet()), true), rig.head, head);
    // 탄띠·탄약 주머니·배낭(독일군: Y 멜빵·빵 주머니·수통)
    const kit = new THREE.Group(), belt = de ? M.boots : M.canvas, box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(unitBox, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; kit.add(m); return m; };
    // 몸통 기준 좌표(앞 +Z, 위 +Y, 원점 = 허리)
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(.165, .165, .055, 16, 1, true), belt); waist.scale.set(1.05, 1, .82); kit.add(waist);
    if (de) { for (const x of [-.09, .09]) box(.07, .08, .045, belt, x, .0, .135); box(.13, .1, .06, M.canvas, -.14, -.06, -.06).rotation.y = .5; const cn = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .14, 10), M.feldDark); cn.position.set(.16, -.05, -.07); kit.add(cn); }
    else { for (const x of [-.12, -.05, .05, .12]) box(.055, .07, .04, belt, x, .0, .14); box(.26, .3, .1, M.canvas, 0, .3, -.17); const cn = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .13, 10), M.canvas); cn.position.set(.16, -.06, -.06); kit.add(cn); }
    put(this._merged(`kit:${faction}`, () => kit, false), rig.waist, pelvis);
    if (de && chest) { const y = new THREE.Group(); for (const s of [-1, 1]) { const st = new THREE.Mesh(unitBox, belt); st.scale.set(.035, .42, .02); st.position.set(s * .07, 0, .13); st.rotation.z = s * .18; y.add(st); const bk = st.clone(); bk.position.z = -.12; y.add(bk); } put(this._merged('ystrap', () => y, false), rig.chest, chest); }
  }
  /**
   * 7단계: 여러 조각으로 된 장비(총·철모·군장)를 재질별로 한 메시로 합친다 → 병사 한 명의 Draw Call 이 크게 준다.
   * 합친 지오메트리는 key 로 캐시해 모든 병사가 공유한다. shadow=false 면 그림자를 드리우지 않는다(작은 군장)
   */
  _merged(key, build, shadow) {
    const cache = this._mergeCache || (this._mergeCache = {});
    let parts = cache[key];
    if (!parts) {
      const root = build(); root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), by = new Map();
      root.traverse((o) => { if (!o.isMesh || !o.visible) return;
        let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        geo.morphAttributes = {}; geo.morphTargetsRelative = false;   // 3인칭 총에는 모프 동작이 없다(남겨 두면 렌더러가 영향값을 찾다 실패)
        if (!geo.attributes.normal) geo.computeVertexNormals();
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        const mats = Array.isArray(o.material) ? o.material : [o.material]; const mat = mats[0];
        if (!by.has(mat)) by.set(mat, []); by.get(mat).push(geo); });
      parts = cache[key] = [...by].map(([mat, geos]) => ({ mat, geo: geos.length > 1 ? mergeGeometries(geos, false) : geos[0] }));
    }
    const g = new THREE.Group(); for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = shadow; g.add(m); } g.userData.lodGear = !shadow; return g;   // 그림자 없는 작은 군장은 멀면 숨긴다
  }
  /** 사복 색으로: 몸·다리·소매 재질을 복제해 색을 곱한다(머리·손은 그대로). 사람마다 따로 */
  _recolor(model, look, tint) {
    const t = tint || (look === 'ffi' ? [1.05, .82, .62] : [.75, .8, 1.15]);
    const civ = look === 'civilian';   // 민간인은 군복 무늬(올리브색 텍스처)를 지우고 밝은 사복 색으로 — 멀리서도 병사와 구분
    model.traverse((o) => { if (!o.isSkinnedMesh || !/Body|Legs|Arms_2|Feet/.test(o.name)) return; o.material = o.material.clone(); const legs = /Legs/.test(o.name), feet = /Feet/.test(o.name);
      if (civ) { o.material.map = null; const k = legs ? .3 : feet ? .12 : .62; o.material.color.setRGB(t[0] * k, t[1] * k, t[2] * k); o.material.needsUpdate = true; return; }
      const k = legs ? .8 : feet ? .55 : 1; o.material.color.setRGB(t[0] * k, t[1] * k, t[2] * k); });
  }
  /** 7단계 텍스처: 병사의 법선·거칠기·금속 맵을 512px 로 줄인다(화면에서 작게 보여 차이가 거의 없고 메모리는 1/4). 진영당 한 번 */
  _shrinkMaps(model, faction) {
    const done = this._shrunk || (this._shrunk = new Set()); if (done.has(faction)) return; done.add(faction);
    const seen = new Set();
    model.traverse((o) => { if (!o.isSkinnedMesh) return; for (const k of ['normalMap', 'roughnessMap', 'metalnessMap']) { const t = o.material[k]; if (!t || !t.image || seen.has(t) || t.image.width <= 512) continue; seen.add(t);
      const c = document.createElement('canvas'); c.width = c.height = 512; c.getContext('2d').drawImage(t.image, 0, 0, 512, 512); t.image = c; t.needsUpdate = true; } });
    this.shrunkMaps = (this.shrunkMaps || 0) + seen.size;
  }
  /** 7단계: 카메라 거리별 병사 LOD — 20m 밖은 눈·눈썹 숨김, 40m 밖은 작은 군장·발밑 그림자 숨김, 45m / 80m 밖은 골격 계산을 2 / 3 프레임에 한 번 */
  lod(owner, camPos) {
    const d = Math.hypot(owner.x - camPos.x, owner.z - camPos.z);
    if (owner.lodFaces) { const v = d < 20; if (owner._faceVis !== v) { owner._faceVis = v; for (const f of owner.lodFaces) f.visible = v; } }
    if (owner.lodGear) { const v = d < 40; if (owner._gearVis !== v) { owner._gearVis = v; for (const o of owner.lodGear) o.visible = v; } }
    if (owner.anim) owner.anim.skip = owner.anim.dead ? 0 : d > 80 ? 2 : d > 45 ? 1 : 0;
    return d;
  }
  /** 진영 모델 하나로 손·머리·허리 뼈의 기준 자세를 재서, 장비를 붙일 국소 변환을 계산한다(한 번만). */
  _measure(model) {
    const root = model.children[0], clips = model.userData.animations || [];
    const aim = clips.find((c) => c.name === 'Aim') || clips.find((c) => c.name === 'AimIdle');
    const mixer = new THREE.AnimationMixer(root);
    const bone = (n) => model.getObjectByName(n);
    const mpos = (n) => { model.updateMatrixWorld(true); return model.worldToLocal(bone(n).getWorldPosition(new V())).multiply(model.scale); };   // 모델 축, 미터 단위
    /** 모델 축 기준 위치·회전(미터) → 뼈에 붙일 국소 위치·회전·배율 */
    const local = (bn, qModel, pModel) => {
      model.updateMatrixWorld(true);
      const want = new THREE.Matrix4().compose(model.localToWorld(pModel.clone().divide(model.scale)), model.getWorldQuaternion(new THREE.Quaternion()).multiply(qModel), new V(1, 1, 1));
      const m = bone(bn).matrixWorld.clone().invert().multiply(want), p = new V(), q = new THREE.Quaternion(), s = new V(); m.decompose(p, q, s);
      return { p, q, s };
    };
    // 1) 조준 자세에서: 총열(−Z)이 병사의 정면(+Z)을 향하도록, 오른손에 쥔다
    if (aim) { mixer.clipAction(aim).play(); mixer.update(0); }
    const hand = mpos('hand_r'), fwd = new V(0, 0, 1);
    const side = new V().crossVectors(fwd, new V(0, 1, 0)).normalize(), up2 = new V().crossVectors(side, fwd).normalize();
    const gunQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up2, fwd.clone().negate()));
    const gun = local('hand_r', gunQ, hand.clone().addScaledVector(up2, .02).addScaledVector(fwd, .05));
    // 2) 기본(바인드) 자세에서: 철모·탄띠·멜빵
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); });
    const I = new THREE.Quaternion();
    const head = local('Head', I, mpos('Head').add(new V(0, .135, .01)));
    const waist = local('pelvis', I, mpos('pelvis').add(new V(0, .07, 0)));
    const chest = local('spine_03', I, mpos('spine_03').add(new V(0, .0, 0)));
    return { gun, head, waist, chest };
  }
  _m1helmet() { // M1 철모: 둥근 몸체 + 넓은 챙
    const g = new THREE.Group(), mat = this.M.helmetUS;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.135, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.scale.set(1, .85, 1.08); g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.152, .158, .012, 22), mat); brim.position.y = .002; brim.scale.z = 1.08; g.add(brim);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(.12, .005, 6, 18, Math.PI), this.M.canvas); strap.rotation.set(0, Math.PI / 2, Math.PI); strap.position.y = -.01; g.add(strap);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  _stahlhelm() { // M35 슈탈헬름: 높은 몸체 + 귀·목을 덮는 넓은 치마
    const g = new THREE.Group(), mat = this.M.helmet;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.13, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.scale.set(1, 1.0, 1.1); g.add(dome);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(.135, .168, .07, 22, 1, true), mat); skirt.position.set(0, -.03, -.008); skirt.scale.z = 1.12; skirt.material.side = THREE.DoubleSide; g.add(skirt);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(.14, .15, .01, 22, 1, false, -.9, 1.8), mat); visor.position.set(0, .0, .012); g.add(visor);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  /** 3인칭 총(총열 −Z, 손잡이가 원점). 미군 개런드는 1인칭과 같은 GLB 를 재사용한다 */
  _gun(kind) {
    if (kind === 'garand' || kind === 'thompson') {
      const m = this.assets.instantiate(`weapons.${kind}`, { anchor: 'origin' });
      if (m) {
        const spec = this.assets.spec(`weapons.${kind}`) || {};
        if (spec.materials) m.traverse((o) => { if (!o.isMesh) return; const sw = (x) => (x && spec.materials[x.name] && this.VM[spec.materials[x.name]]) || x; o.material = Array.isArray(o.material) ? o.material.map(sw) : sw(o.material); o.castShadow = true; });
        const wrap = new THREE.Group(); m.position.z = kind === 'garand' ? .1 : .07; wrap.add(m); return wrap;
      }
    }
    const M = this.M, g = new THREE.Group(), add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
    if (kind === 'mp40') {   // MP40: 짧은 총열 + 접이식 개머리 + 아래로 긴 탄창
      add(new THREE.BoxGeometry(.04, .06, .3), M.gun, 0, .02, -.08);
      add(new THREE.CylinderGeometry(.012, .012, .26, 8), M.gun, 0, .03, -.35, Math.PI / 2);
      add(new THREE.BoxGeometry(.03, .2, .035), M.gun, 0, -.1, -.12);
      add(new THREE.BoxGeometry(.035, .1, .04), M.woodDark, 0, -.05, .04);
      add(new THREE.BoxGeometry(.01, .05, .22), M.gun, 0, .0, .18);
    } else {                  // Kar98k (garand 슬롯이 없을 때 미군도 이 모양을 쓴다)
      add(new THREE.BoxGeometry(.045, .07, .62), kind === 'garand' ? M.wood : M.woodDark, 0, -.01, -.17);
      add(new THREE.BoxGeometry(.04, .12, .3), kind === 'garand' ? M.wood : M.woodDark, 0, -.04, .22).rotation.x = -.18;
      add(new THREE.CylinderGeometry(.009, .011, .5, 8), M.gun, 0, .03, -.7, Math.PI / 2);
      add(new THREE.BoxGeometry(.03, .03, .16), M.gun, 0, .035, -.04);
      add(new THREE.CylinderGeometry(.005, .005, .05, 6), M.gun, .03, .04, .0).rotation.z = Math.PI / 2;
    }
    return g;
  }
  /** 장면 밖 애니메이션 갱신이 필요 없도록, 각 병사의 update 에서 owner.anim.update 를 부른다. */
}
