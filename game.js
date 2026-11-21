// =====================================================================
//  D-DAY: 오마하 해변 — 1인칭 슈팅  (게임 로직 계층)
//
//  이 파일은 규칙만 다룬다: 플레이어 이동·사격·재장전, 적군/아군 AI, 피해 계산, 보급, 포격, HUD, 승패.
//  보이는 것은 src/graphics/ 의 매니저가 맡는다.
//    Renderer · LightingManager · AssetManager · EnvironmentManager · EffectsManager · CharacterManager · WeaponManager
//  구조와 검증 결과: docs/PHASE1_REPORT.md · GLB 교체 방법: docs/ASSETS.md
// =====================================================================
import * as THREE from 'three';
import { DEBUG, PARAMS, $, V3, rand, gauss, clamp, lerp } from './src/core/utils.js';
import { heightAt, groundNormal, solids, pushOut, insideCollider, terrainHit, losClear, setTerrain, groundBelow } from './src/game/world.js';
import { createAudio } from './src/game/audio.js';
import { createTouchControls } from './src/game/touch.js';
import { Renderer } from './src/graphics/Renderer.js';
import { AssetManager } from './src/graphics/AssetManager.js';
import { LightingManager } from './src/graphics/LightingManager.js';
import { createProceduralTextures } from './src/graphics/textures.js';
import { createMaterials } from './src/graphics/materials.js';
import { EnvironmentManager } from './src/graphics/EnvironmentManager.js';
import { EffectsManager } from './src/graphics/EffectsManager.js';
import { CharacterManager } from './src/graphics/CharacterManager.js';
import { WeaponManager } from './src/graphics/WeaponManager.js';
import { CAMPAIGN, STAGES, stageById } from './src/campaign/stages.js';
import { CampaignManager, ObjectiveTracker } from './src/campaign/CampaignManager.js';
import { STAGE1_OBJECTIVES, tagStage1Zones } from './src/campaign/stage1.js';
import { CinematicPlayer } from './src/campaign/Cinematic.js';
import { CINEMATICS } from './src/campaign/cinematics.js';

// ---------------------------------------------------------------- 캠페인: 어느 스테이지를 불러올지 (?stage=N, 아직 안 만든 스테이지는 1)
const campaign = new CampaignManager();
if (PARAMS.has('unlockall')) campaign.unlockAll();
const STAGE = (() => { const s = stageById(+PARAMS.get('stage') || 1); return s.built ? s : STAGES[0]; })();
/** Stage 2 부터는 스테이지 모듈(src/stages/stageN.js)이 지형·전장·배치·목표를 맡는다. Stage 1 은 기존 코드 그대로(SM = null) */
const SM = STAGE.id === 1 ? null : (await import(`./src/stages/stage${STAGE.id}.js`)).default;
if (SM) setTerrain(SM.terrain);
/** 난이도: Stage 2~5 는 초등학생도 끝까지 갈 수 있게 낮춘다(Stage 1 은 원래 그대로). ?hard 를 붙이면 원래 난이도
 *  hit 적 명중률 · dmg 적 피해 · ehp 적 체력 · boom 적 포탄 피해 · regen 초당 체력 회복(맞은 뒤 regenDelay 초부터)
 *  med/ammo 쓰러진 적이 구급상자/탄약을 떨어뜨릴 확률 · grace 시작·부활 직후 적 명중률이 낮은 시간 · checkpoint 전사 시 이어 하기 */
const DIFF = SM && !PARAMS.has('hard')
  ? { hit: .55, dmg: .7, ehp: .8, boom: .55, regenDelay: 4, regen: 8, med: .32, ammo: .36, grace: 10, checkpoint: true }
  : { hit: 1, dmg: 1, ehp: 1, boom: 1, regenDelay: 0, regen: 0, med: .18, ammo: .4, grace: 6, checkpoint: false };

// ---------------------------------------------------------------- 그래픽 초기화
const canvas = $('c');
const renderer = new Renderer(canvas);
const camera = renderer.camera;
const assets = new AssetManager();
let assetsReady = false;
const goLabel = document.querySelector('#start .go');
assets.onProgress((p) => { if (!assetsReady && goLabel) goLabel.textContent = `전장 불러오는 중… ${Math.round(p * 100)}%`; });

// 모델 매니페스트: 기본은 assets/models/manifest.json, ?models=이름 이면 manifest.이름.json
const manifestName = (PARAMS.get('models') || '').replace(/[^a-z0-9_-]/gi, '');
await assets.loadManifest(`./assets/models/manifest${manifestName ? '.' + manifestName : ''}.json`, { stage: STAGE.id });   // 스테이지별로 필요한 모델만

const textures = createProceduralTextures();
const materials = createMaterials(assets);
const lighting = new LightingManager(renderer);
const env = new (SM ? SM.Env : EnvironmentManager)({ renderer, lighting, assets, materials, textures });
env.build();
lighting.loadSky(assets, './assets/sky_2k.hdr', materials.all).then((ok) => { if (ok) env.useHdriSky(); });
const fx = new EffectsManager({ renderer, lighting, materials, textures });
const characters = new CharacterManager({ renderer, assets, materials });
const weaponView = new WeaponManager({ renderer, assets, materials, textures });
// 5단계 그래픽: 구름 그림자를 모든 표준 재질에, 불타는 전차에 화염광. ?gfx=legacy 로 4단계 화면, F8 로 실시간 전환
for (const [x, z] of env.fireSources || env.smokeSources) lighting.addFire(new V3(x, heightAt(x, z) + 1.6, z));   // 불빛(점광원)은 스테이지가 고른 몇 곳만
lighting.patchScene();
// 7단계 텍스처: GLB 모델 텍스처에도 비등방 필터(8×) — 비스듬히 보이는 면이 흐려지지 않게
assets.onTemplateMaterial((m) => { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) { const t = m[k]; if (t && t.anisotropy < 8) { t.anisotropy = 8; if (t.image) t.needsUpdate = true; } } });
renderer.setQuality(PARAMS.get('gfx') === 'legacy' ? 'legacy' : 'high');
// ?pr=1.5 처럼 고정 해상도로 실행(측정용), 자가 테스트에서는 동적 해상도를 끈다
if (PARAMS.has('pr')) { renderer.adaptive = false; renderer.gl.setPixelRatio(+PARAMS.get('pr') || 1); renderer.resize(); }
if (PARAMS.has('selftest')) renderer.adaptive = false;

const _rc = new THREE.Raycaster(), _v = new V3(), _v2 = new V3(), _v3 = new V3();
const audio = createAudio(() => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }), { ambience: SM ? SM.ambience : 'beach' }), { init: initAudio, sfx } = audio;
const cine = new CinematicPlayer({ heightAt, sfx, music: (...a) => audio.music(...a) });   // 인트로·아웃트로

// ---------------------------------------------------------------- 폭발 (연출은 EffectsManager, 피해는 여기)
let shake = 0;
function explode(pos, radius, dmg, byPlayer) {
  fx.explosion(pos, radius);
  if (SM && SM.onExplosion) SM.onExplosion(pos, stageApi);
  { const gy = heightAt(pos.x, pos.z); if (pos.y - gy < 1.2 && !(gy < .1 && pos.z > 72)) fx.decal('scorch', _v3.set(pos.x, gy, pos.z), groundNormal(pos.x, pos.z), radius * .75, undefined, 120); }   // 포탄 자국
  sfx('boom', pos, radius / 6);
  const pd = pos.distanceTo(player.pos);
  shake = Math.max(shake, clamp(2.2 - pd / 14, 0, 1.6) * radius / 6);
  if (pd < radius * 1.6) flashScreen(clamp(1 - pd / (radius * 1.6), 0, .6));
  { const k = clamp(1.25 - pd / (radius * 2.2), 0, 1); if (k > 0) { renderer.shockPulse(k); sfx('shock', k); } }   // 가까운 폭발: 화면 흔들림 + 먹먹함·귀울림
  if (pd < radius && !player.dead) damagePlayer(dmg * (1 - pd / radius) * (byPlayer ? .6 : DIFF.boom), pos);
  if (!byPlayer) for (const a of allies) { if (!a.alive) continue; const d = Math.hypot(a.x - pos.x, a.z - pos.z); if (d < radius * .8) a.damage(dmg * 1.4 * (1 - d / (radius * .8)), pos); }
  if (byPlayer) for (const e of enemies) {
    if (!e.alive) continue; const d = Math.hypot(e.x - pos.x, e.z - pos.z, e.y + 1 - pos.y);
    if (d < radius) { _v2.set(e.x - pos.x, .6, e.z - pos.z).normalize(); if (damageEnemy(e, dmg * 2.2 * (1 - d / radius), 'body', _v2, 9, null)) hitMark(true); else hitMark(false); }
  }
}

// ---------------------------------------------------------------- 적군
const ETYPES = {
  rifle: { hp: 70, dmg: 13, range: 82, pNear: .42, pFar: .09, speed: 2.4, engage: 18, keep: 9, mag: 5, reload: 2.4 },     // Kar98k 5발 클립
  smg: { hp: 70, dmg: 6, range: 42, pNear: .36, pFar: .08, speed: 3.3, engage: 62, keep: 8, mag: 32, reload: 2.2 },      // MP40 32발
  mg: { hp: 90, dmg: 6, range: 96, pNear: .2, pFar: .035, speed: 0, engage: 0, keep: 0, mag: 50, reload: 3.2 },          // MG42 50발 탄띠
  sniper: { hp: 60, dmg: 38, range: 170, pNear: .5, pFar: .26, speed: 0, engage: 0, keep: 0, mag: 5, reload: 3 },      // 조준경 Kar98k — 느리지만 아프다
};
const EBOX = SM && SM.enemyBox ? SM.enemyBox : { minX: -66, maxX: 66, minZ: -82, maxZ: 70 };
const enemies = []; let shootables = [], shootDirty = true;
class Enemy {
  constructor(type, x, z, muzzle, opts = {}) {
    const T = ETYPES[type];
    Object.assign(this, { type, T, hp: T.hp * DIFF.ehp, x, z, y: opts.fixedY ?? heightAt(x, z), fixedY: opts.fixedY ?? null, holdPos: !!opts.holdPos, engage: opts.engage ?? T.engage, alive: true, cool: rand(1.5, 4), burst: 0, burstGap: 0, losT: rand(.3), los: false, strafe: Math.random() < .5 ? 1 : -1, strafeT: rand(1, 2), walk: 0, flinch: 0, yaw: 0, fixedMuzzle: muzzle || null, meshes: [], deadT: 0, kv: new V3(), fall: 1, seen: false, rounds: T.mag });
    characters.create(this, 'german', { gunLen: type === 'smg' ? .4 : .78, mag: type === 'smg', hitZones: true, weapon: type === 'smg' ? 'smg' : 'rifle' }); enemies.push(this); shootDirty = true;   // 전투 중에 생긴 적(반격 병력)도 사격 판정에 넣는다
  }
  muzzle(out) { if (this.fixedMuzzle) return out.copy(this.fixedMuzzle); return out.set(this.x + Math.sin(this.yaw) * .9, this.y + (this.crouch ? 1.05 : 1.45), this.z + Math.cos(this.yaw) * .9); }
  update(dt) {
    const g = this.group;
    if (!this.alive) {
      if (this.deadT > 30) return; this.deadT += dt;
      const k = Math.min(1, this.deadT / .42); this.body.rotation.x = -this.fall * (1 - (1 - k) * (1 - k)) * 1.5;
      this.x += this.kv.x * dt; this.z += this.kv.z * dt; this.kv.multiplyScalar(Math.exp(-dt * 5));
      _v.set(this.x, 0, this.z); pushOut(_v, .3, this.y, 1); this.x = _v.x; this.z = _v.z;
      this.y = heightAt(this.x, this.z); g.position.set(this.x, this.y + (this.anim ? 0 : .12 * k), this.z);
      if (this.anim) this.anim.update(dt, { speed: 0 });
      if (this.deadT > 30) characters.release(this); return;
    }
    const T = this.T, dx = player.pos.x - this.x, dz = player.pos.z - this.z, dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz); let dy = want - this.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; this.yaw += dy * Math.min(1, dt * 6); g.rotation.y = this.yaw;
    // line of sight (cached)
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = .3 + rand(.1); const inArc = this.type !== 'mg' || dist < 14 || (dz > 1 && Math.abs(dx) < 46); this.los = !player.dead && inArc && dist < T.range && losClear(this.muzzle(_v2), _v3.copy(player.eye).setY(player.eye.y - .25)); if (this.los) this.seen = true;
      if (this.allyT && !this.allyT.alive) this.allyT = null;
      if (allies.length) { const a = allies[Math.random() * allies.length | 0]; if (a.alive && Math.hypot(a.x - this.x, a.z - this.z) < T.range && (this.type !== 'mg' || a.z > this.z + 1) && losClear(this.muzzle(_v2), _v3.set(a.x, a.y + 1.2, a.z))) this.allyT = a; } }
    // 저격수: 조준경이 햇빛에 번쩍인다(플레이어를 볼 때 1.2초마다) — 위치를 알려 주는 경고
    if (this.type === 'sniper' && this.los && (this.glintT = (this.glintT || 0) - dt) <= 0) { this.glintT = 1.2; fx.sprite('flash', this.muzzle(_v2), { size: .55, life: .12, color: 0xfff2c0 }); }
    // movement
    let moving = false;
    if (T.speed && !this.holdPos && dist < this.engage && (this.seen || dist < 14)) {   // holdPos = 진지를 지키는 병사(사격 구멍·박격포)
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(.8, 2.2); this.strafe = -this.strafe; }
      const nx = dx / dist, nzz = dz / dist, f = dist > T.keep + 2 ? 1 : dist < T.keep - 3 ? -.7 : 0;
      let mx = nx * f + -nzz * this.strafe * .6, mz = nzz * f + nx * this.strafe * .6; const ml = Math.hypot(mx, mz);
      if (ml > .05) { mx /= ml; mz /= ml; _v.set(this.x + mx * T.speed * dt, 0, this.z + mz * T.speed * dt); pushOut(_v, .35, this.y, 1.7); _v.x = clamp(_v.x, EBOX.minX, EBOX.maxX); _v.z = clamp(_v.z, EBOX.minZ, EBOX.maxZ); moving = Math.hypot(_v.x - this.x, _v.z - this.z) > T.speed * dt * .3; this.x = _v.x; this.z = _v.z; this.y = heightAt(this.x, this.z); }
    }
    this.walk += dt * (moving ? 10 : 0); const sw = moving ? Math.sin(this.walk) * .6 : 0; this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.flinch = Math.max(0, this.flinch - dt * 5); this.body.rotation.x = -this.flinch * .3; this.body.position.y = moving ? Math.abs(Math.sin(this.walk)) * .04 : 0;
    g.position.set(this.x, this.y, this.z);
    if (this.anim) {   // 골격 애니메이션: 이동 속도·조준 여부·조준 높이
      const tg = this.tgt && this.tgt.alive ? _v3.set(this.tgt.x, this.tgt.y + 1.3, this.tgt.z) : _v3.copy(player.eye), hd = Math.hypot(tg.x - this.x, tg.z - this.z) || 1;
      this.anim.update(dt, { speed: moving ? T.speed : 0, crouch: false, aiming: this.los || !!this.allyT || this.burst > 0, pitch: Math.atan2(tg.y - (this.y + 1.45), hd) });
    }
    // firing
    this.cool -= dt;
    if (this.burst > 0) { this.burstGap -= dt; if (this.burstGap <= 0) { this.burst--; this.burstGap = this.type === 'mg' ? .05 : .11; this.fire(dist); if (this.rounds <= 0) this.burst = 0; if (this.burst === 0 && this.rounds > 0) this.cool = this.type === 'mg' ? rand(1.1, 2.4) : rand(1.1, 2.2); } }
    else if (this.cool <= 0 && (this.los || this.allyT)) {
      this.tgt = this.los && (!this.allyT || Math.random() < .62) ? null : this.allyT;
      if (this.type === 'rifle') { this.fire(dist); this.cool = rand(2.1, 3.6); }
      else if (this.type === 'sniper') { this.fire(dist); this.cool = rand(3.6, 5.4); }
      else { this.burst = this.type === 'mg' ? 13 + (Math.random() * 15 | 0) : 3 + (Math.random() * 4 | 0); this.burstGap = 0; }   // MG42: 분당 1,200발(0.05초 간격)
    }
  }
  fire(dist) {
    const T = this.T, mz = this.muzzle(new V3());
    if (this.anim) this.anim.fire();
    if (--this.rounds <= 0) { this.rounds = T.mag; this.cool = T.reload; if (this.anim) this.anim.reload(); }   // 탄이 떨어지면 재장전하는 동안 쏘지 않는다
    sfx('enemyShot', this.type, mz);
    fx.sprite('flash', mz, { size: this.type === 'mg' ? 1.3 : .8, life: .05 }); lighting.enemyFlash(mz, player.pos, this.type === 'mg' ? 80 : 55);
    const a = this.tgt;
    if (a) { // shooting at an allied soldier instead of the player
      if (!a.alive) return; const ad = Math.hypot(a.x - this.x, a.z - this.z), ahit = Math.random() < lerp(T.pNear, T.pFar, clamp(ad / T.range, 0, 1)) * .5 * (this.type === 'mg' ? .667 : 1);
      if (ahit) { fx.tracer(mz, _v.set(a.x, a.y + 1.2, a.z), true); a.damage(T.dmg * rand(.8, 1.2), mz); }
      else { _v.set(a.x + gauss() * 1.6, 0, a.z + gauss() * 1.6); _v.y = heightAt(_v.x, _v.z); fx.tracer(mz, _v, true); bulletImpact('terrain', _v, null, null, .6, 20); }
      return;
    }
    let p = lerp(T.pNear, T.pFar, clamp(dist / T.range, 0, 1)) * (this.type === 'mg' ? .667 : 1);   // MG42 는 발사 간격을 0.075 → 0.05초로 줄인 만큼 한 발 명중률을 낮춰 초당 피해는 같게
    if (player.sprinting) p *= .6; if (player.crouch) p *= .65; if (!this.los) p = 0; if (state.grace > 0) p *= .25; if (state.time - state.lastHurt < .4) p *= .3;
    p *= DIFF.hit;
    const hit = !player.dead && Math.random() < p;
    if (hit) { fx.tracer(mz, _v.copy(player.eye).setY(player.eye.y - .35), true); damagePlayer(T.dmg * DIFF.dmg * rand(.8, 1.2), mz); }
    else {
      const a = rand(6.28), r = rand(.7, 3); _v.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r); _v.y = heightAt(_v.x, _v.z);
      // misses blocked by cover should stop at the cover
      _v2.subVectors(_v, mz); const L = _v2.length(); _v2.multiplyScalar(1 / L); _rc.set(mz, _v2); _rc.far = L; const h = _rc.intersectObjects(solids, false)[0];
      if (h) { _v.copy(h.point); bulletImpact(surfaceOf(h.object), _v, h.face ? _v3.copy(h.face.normal).transformDirection(h.object.matrixWorld) : null, _v2, .8); }
      else bulletImpact('terrain', _v, null, _v2, .8, 25);
      fx.tracer(mz, _v, true);
      if (r < 2 && Math.random() < .45) sfx('whiz', rand(-1, 1));
    }
  }
}
function damageEnemy(e, dmg, part, dir, knock, point) {
  if (!e.alive) return false;
  if (part === 'head') dmg *= 2.6; else if (part === 'leg') dmg *= .75;
  e.hp -= dmg; e.flinch = 1; e.seen = true; e.cool = Math.max(e.cool, .25);
  if (point) { fx.debrisBurst('blood', point, part === 'head' ? 14 : 8, 2.2, 1.6, .07, .8, _v3.copy(dir).multiplyScalar(3)); fx.sprite('smoke', point, { size: .35, grow: 3, life: .28, alpha: .7, color: 0x8a0d0a }); }
  if (e.hp > 0) { if (e.anim) e.anim.hit(part, dir, knock); return false; }
  e.alive = false; shootDirty = true; state.kills++; if (e.anim) e.anim.die(dir, knock);
  e.kv.set(dir.x, 0, dir.z).normalize().multiplyScalar(knock);
  e.fall = (dir.x * Math.sin(e.yaw) + dir.z * Math.cos(e.yaw)) > 0 ? -1 : 1;
  e.legL.rotation.x = rand(-.5, .5); e.legR.rotation.x = rand(-.5, .5); e.body.rotation.z = rand(-.3, .3);
  if (point) fx.debrisBurst('blood', point, 12, 3.2, 2.5, .09, 1, _v3.copy(dir).multiplyScalar(4));
  const r = Math.random(); if (r < DIFF.ammo) addPickup('ammo', e.x, e.z); else if (r < DIFF.ammo + DIFF.med) addPickup('med', e.x, e.z);
  return true;
}
// MG gunners
if (!SM) {   // ---- Stage 1 배치(기존 그대로)
for (const bx of [-36, 0, 36]) new Enemy('mg', bx, -37.1, new V3(bx, 14.38, -35.45));
for (const x of [-27, -24.5, -13, 13, 15.5, 26, -51, 51]) new Enemy('rifle', x, -36.9);
for (const x of [-25, 13, 42]) new Enemy('rifle', x, -13.9);
for (const [x, z] of [[-18, -53.4], [18, -53.4], [0, -63.4], [-40, -59.4], [40, -59.4], [8, -70], [-8, -71]]) new Enemy('smg', x, z);
new Enemy('rifle', -25, -68); new Enemy('rifle', 25, -68);
tagStage1Zones(enemies);   // 목표 진행용 구역(기관총 진지 / 능선 방어선 / 후방)
}

// ---------------------------------------------------------------- 아군
// ---------------------------------------------------------------- allies
const allies = [], _a1 = new V3(), _a2 = new V3(), _a3 = new V3();
const ABOX = SM && SM.allyBox ? SM.allyBox : { minX: -66, maxX: 66, minZ: -82, maxZ: 80.5 }, PBOX = SM && SM.playerBox ? SM.playerBox : ABOX;
const SEAWALL_GAPS = [-37, -9, 13, 41], CREST_GAPS = [-42, -20, -6, 6, 20, 42];
const nearestOf = (arr, x) => arr.reduce((b, g) => (Math.abs(g - x) < Math.abs(b - x) ? g : b));
class Ally {
  /** opts.look = 'ffi' 이면 레지스탕스 대원(사복·베레모·완장) */
  constructor(x, z, opts = {}) {
    Object.assign(this, { x, z, y: heightAt(x, z), hp: 60, alive: true, yaw: Math.PI, lane: x, path: [], wait: rand(.2, 2.2), cool: rand(1, 3), tgt: null, tgtT: rand(.6), walk: 0, deadT: 0, kv: new V3(), fall: 1, crouchK: 0, stuck: 0, stuckN: 0, sideT: 0, side: 1, flinch: 0, rounds: 8 });
    characters.create(this, 'american', { gunLen: .72, weapon: opts.weapon || 'garand', look: opts.look || null, tint: opts.tint || null }); allies.push(this); this.look = opts.look || null;
  }
  muzzle(out) { return out.set(this.x + Math.sin(this.yaw) * .9, this.y + 1.45 - this.crouchK * .35, this.z + Math.cos(this.yaw) * .9); }
  plan() { // next rush: keep roughly level with the player, never fall back
    if (SM && SM.allyPlan) { this.path = SM.allyPlan(this, player, rand); return; }
    const p = player.pos; let tz = clamp(p.z + (p.z < -30 ? rand(-9, 9) : rand(-3, 9)), -78, 80); tz = Math.min(Math.max(tz, this.z - 15), this.z);
    const tx = clamp(p.z < -34 ? p.x + rand(-16, 16) : this.lane + rand(-4, 4), -62, 62);
    this.path.length = 0; let px = this.x;
    if (this.z > -1.8 && tz < -3) { px = nearestOf(SEAWALL_GAPS, px); this.path.push([px, -1.4], [px, -5]); }
    if (this.z > -34.5 && tz < -35) { px = nearestOf(CREST_GAPS, px); this.path.push([px, -33.6], [px, -37.8]); }
    _a1.set(tx, 0, tz); pushOut(_a1, .7, heightAt(tx, tz), 1.7); this.path.push([_a1.x, _a1.z]);
  }
  damage(d, from) {
    if (!this.alive) return; this.hp -= d; this.flinch = 1;
    fx.debrisBurst('blood', _a3.set(this.x, this.y + 1.2, this.z), 7, 2, 1.5, .07, .8);
    if (this.hp > 0) { if (this.anim) this.anim.hit('body'); return; }
    if (this.anim) this.anim.die();
    this.alive = false; this.kv.set(this.x - from.x, 0, this.z - from.z).normalize().multiplyScalar(3);
    this.fall = (this.kv.x * Math.sin(this.yaw) + this.kv.z * Math.cos(this.yaw)) > 0 ? -1 : 1;
    this.legL.rotation.x = rand(-.5, .5); this.legR.rotation.x = rand(-.5, .5); this.body.rotation.z = rand(-.3, .3); this.body.position.y = 0;
  }
  update(dt) {
    const g = this.group;
    if (!this.alive) {
      if (this.deadT > 30) return; this.deadT += dt;
      const k = Math.min(1, this.deadT / .42); this.body.rotation.x = -this.fall * (1 - (1 - k) * (1 - k)) * 1.5;
      this.x += this.kv.x * dt; this.z += this.kv.z * dt; this.kv.multiplyScalar(Math.exp(-dt * 5));
      this.y = heightAt(this.x, this.z); g.position.set(this.x, Math.max(this.y, -.1) + (this.anim ? 0 : .12 * k), this.z);
      if (this.anim) this.anim.update(dt, { speed: 0 });
      if (this.deadT > 30) characters.release(this); return;
    }
    // pick a target
    this.tgtT -= dt;
    if (this.tgtT <= 0) { this.tgtT = rand(.5, .9);
      let c = this.tgt && this.tgt.alive && Math.random() < .7 ? this.tgt : enemies[Math.random() * enemies.length | 0]; this.tgt = null;
      if (c.alive) { const d = Math.hypot(c.x - this.x, c.z - this.z); if (d < 75 && losClear(this.muzzle(_a1), _a2.set(c.x, c.y + 1.3, c.z))) { this.tgt = c; this.tgtD = d; } } }
    // move in rushes
    let moving = false, face = null;
    if (this.wait > 0) this.wait -= dt;
    else if (!this.hold) {   // hold = 합류 전까지 제자리(Stage 2 정찰병)
      if (!this.path.length) this.plan();
      const w = this.path[0]; let dx = w[0] - this.x, dz = w[1] - this.z; const d = Math.hypot(dx, dz);
      if (d < .5) { this.path.shift(); this.stuckN = 0; if (!this.path.length) this.wait = rand(1.2, 3.8); }
      else {
        dx /= d; dz /= d; if (this.sideT > 0) { this.sideT -= dt; const t = dx; dx = -dz * this.side; dz = t * this.side; }
        const sp = 4.4 * (this.y < -.25 ? .65 : 1);
        _a1.set(this.x + dx * sp * dt, 0, this.z + dz * sp * dt); pushOut(_a1, .35, this.y, 1.7); _a1.x = clamp(_a1.x, ABOX.minX, ABOX.maxX); _a1.z = clamp(_a1.z, ABOX.minZ, ABOX.maxZ);
        if (Math.hypot(_a1.x - this.x, _a1.z - this.z) < sp * dt * .4) { this.stuck += dt; if (this.stuck > .25) { this.stuck = 0; this.sideT = .55; this.side = Math.random() < .5 ? 1 : -1; if (++this.stuckN > 6) { this.path.length = 0; this.stuckN = 0; this.wait = .5; } } } else this.stuck = 0;
        this.x = _a1.x; this.z = _a1.z; this.y = heightAt(this.x, this.z); moving = true; face = Math.atan2(dx, dz);
        if ((this.stepT = (this.stepT || 0) - dt) <= 0 && this.z > -4) { this.stepT = .32; footprint(this.x, this.z, this.yaw, (this.footSide = -(this.footSide || 1)), 20); }
      }
    }
    if (!moving && this.tgt) face = Math.atan2(this.tgt.x - this.x, this.tgt.z - this.z);
    if (face !== null) { let dy = face - this.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; this.yaw += dy * Math.min(1, dt * 8); }
    g.rotation.y = this.yaw;
    this.crouchK = lerp(this.crouchK, moving ? 0 : 1, Math.min(1, dt * 7)); this.flinch = Math.max(0, this.flinch - dt * 5);
    this.walk += dt * (moving ? 12 : 0); const sw = moving ? Math.sin(this.walk) * .55 : 0;
    this.legL.rotation.x = sw - this.crouchK * 1.1; this.legR.rotation.x = -sw + this.crouchK * .55;
    this.body.position.y = -this.crouchK * .3 + (moving ? Math.abs(Math.sin(this.walk)) * .05 : 0); this.body.rotation.x = (moving ? .18 : 0) - this.flinch * .3;
    g.position.set(this.x, this.y, this.z);
    if (this.anim) {   // 돌진은 달리기, 멈추면 무릎 쏴(웅크림), 목표가 있으면 조준
      const t = this.tgt && this.tgt.alive ? this.tgt : null, hd = t ? Math.hypot(t.x - this.x, t.z - this.z) || 1 : 1;
      this.anim.update(dt, { speed: moving ? 4.4 * (this.y < -.25 ? .65 : 1) : 0, crouch: !moving && this.crouchK > .5, aiming: !moving && !!t, pitch: t ? Math.atan2(t.y + 1.3 - (this.y + 1.1), hd) : 0 });
    }
    // shoot while halted
    this.cool -= dt;
    if (!moving && this.cool <= 0 && this.tgt && this.tgt.alive) {
      this.cool = rand(1.3, 3.1); const e = this.tgt, mz = this.muzzle(new V3());
      if (this.anim) this.anim.fire();
      if (--this.rounds <= 0) { this.rounds = 8; this.cool = 2.4; if (this.anim) this.anim.reload(); }   // 개런드 8발 클립
      sfx('enemyShot', 'garand', mz); fx.sprite('flash', mz, { size: .8, life: .05 });
      if (Math.random() < lerp(.4, .1, clamp(this.tgtD / 75, 0, 1))) {
        const pt = new V3(e.x, e.y + 1.2, e.z), dir = new V3().subVectors(pt, mz).normalize(); fx.tracer(mz, pt, false);
        if (damageEnemy(e, 38, 'body', dir, 3, pt)) { state.kills--; state.allyKills++; }
      } else fx.tracer(mz, _a2.set(e.x + gauss() * 1.4, e.y + rand(.2, 2.4), e.z - 3 + gauss()), false);
    }
  }
}
if (!SM) for (const [x, z] of [[-31, 78], [-23, 76.5], [-12, 78.5], [-4.5, 76], [4.5, 76.5], [10, 78], [19, 77], [28, 78.5], [37, 76.5]]) new Ally(x, z);

// ---------------------------------------------------------------- 보급품
const pickups = [];
function addPickup(type, x, z) {
  const g = env.createPickup(type);
  g.position.set(x, heightAt(x, z) + .45, z); renderer.scene.add(g); pickups.push({ type, g, x, z, y: g.position.y, t: rand(6) });
}
if (!SM) {
for (const [x, z] of [[-20, 30], [18, 13], [-4, -1.6], [26, -1.6], [-30, -1.6], [50, -1.6], [0, -44], [-36, -44], [36, -44]]) addPickup('med', x, z);
for (const [x, z] of [[11, 40], [-13, -1.6], [34, -1.6], [15, -46], [-15, -46], [0, -76]]) addPickup('ammo', x, z);
} else SM.spawn({ Enemy, Ally, addPickup, V3, env, characters });   // 스테이지 모듈의 배치

// ---------------------------------------------------------------- 플레이어와 무기 규칙
const player = { pos: SM ? new V3(SM.playerStart.x, 0, SM.playerStart.z) : new V3(0, 0, 77.5), vel: new V3(), yaw: SM ? SM.playerStart.yaw : 0, pitch: 0.06, eye: new V3(), eyeH: 1.7, hp: 100, crouch: false, sprinting: false, onGround: true, dead: false, deadT: 0, grenades: 3, walkT: 0, moveAmt: 0 };
player.pos.y = heightAt(player.pos.x, player.pos.z);
// 스테이지 목표: 순서대로 켜지고, 마지막 목표를 끝내면 작전 성공
const objectives = new ObjectiveTracker((SM ? SM.objectives : STAGE1_OBJECTIVES).map((d, i) => ({ ...d, text: STAGE.objectives[i] })), {
  onAdvance: (i, cur) => { banner(`목표 ${i} 완료`, cur.text, 3.5); sfx('pickup'); },
  onComplete: () => { if (!state.won) { state.won = true; state.winT = SM && SM.winDelay ? SM.winDelay : 2.2; banner('작전 성공', STAGE.title + (SM && SM.winText ? SM.winText : ' 확보')); if (SM && SM.onWin) SM.onWin(stageApi); } },
});
const state = { lastHurt: -9, allyKills: 0, reinT: 22, mode: 'menu', paused: false, time: 0, kills: 0, shots: 0, hits: 0, grace: DIFF.grace, artT: 5, distT: 1, won: false, winT: 0, phase: 0 };

const SWITCH_TIME = .36;
/**
 * 무기 규칙표. id 는 WeaponManager 뷰모델과 매니페스트 슬롯(weapons.<id>)에 쓰인다.
 *  kind   semi(반자동) · auto(자동) · pump(펌프액션) · bolt(볼트액션) — 쏜 뒤 cycle 초 동안 펌프/볼트를 조작해야 다음 발
 *  load   clip(엔블록 클립 통째) · mag(탄창 교환) · single(한 발씩: reloadOpen + 발당 reload + reloadClose)
 *  falloff [근거리 한계 m, 원거리 m, 원거리 배율] — 그 사이에서 피해가 선형으로 줄어든다
 *  bloom  연사 시 탄퍼짐 증가량(발당) · recoilReturn 반동 후 조준점이 원래 자리로 돌아옴
 *  scope  우클릭으로 스코프 전환(누르고 있지 않아도 됨), zoom 은 스코프 시야각
 */
const WEAPONS = [
  { id: 'garand', name: 'M1 개런드', kind: 'semi', load: 'clip', mag: 8, reserve: 72, dmg: 62, pellets: 1, cooldown: .2, auto: false, spread: .006, adsSpread: .0008, range: 250, falloff: [150, 250, .8], rp: .05, kick: .1, reload: 2.1, knock: 4.5, sfx: 'garand', shake: .22, zoom: 42, flash: .5 },
  { id: 'thompson', name: 'M1A1 톰슨', kind: 'auto', load: 'mag', mag: 30, reserve: 150, dmg: 25, pellets: 1, cooldown: .088, auto: true, spread: .024, adsSpread: .011, bloom: .22, range: 120, falloff: [25, 80, .5], rp: .017, kick: .045, reload: 2.4, knock: 2.5, sfx: 'thompson', shake: .12, zoom: 55, flash: .38 },
  { id: 'trench', name: 'M1897 트렌치건', kind: 'pump', load: 'single', mag: 6, reserve: 30, dmg: 17, pellets: 10, cooldown: .1, cycle: .62, auto: false, spread: .062, adsSpread: .045, range: 60, falloff: [11.25, 40.5, .35], rp: .11, kick: .2, reload: .5, reloadOpen: .3, reloadClose: .25, knock: 11, sfx: 'trench', shake: .5, zoom: 58, flash: .62 },
  { id: 'springfield', name: 'M1903A4 스프링필드', kind: 'bolt', load: 'single', mag: 5, reserve: 30, dmg: 125, pellets: 1, cooldown: .1, cycle: 1.05, auto: false, spread: .035, adsSpread: .0002, range: 420, rp: .16, kick: .26, reload: .55, reloadOpen: .45, reloadClose: .45, knock: 8, sfx: 'springfield', shake: .38, zoom: 16, flash: .7, scope: true, recoilReturn: true },
];
const weapons = WEAPONS.map((def) => ({ def, ammo: def.mag, reserve: def.reserve }));
weaponView.build(WEAPONS);
const wp = { i: 0, cool: 0, switchT: 0, next: -1, kick: 0, kickRot: 0, recoil: 0, ads: 0, swayX: 0, swayY: 0, lastFire: 9, pingT: 0, heat: 0, scoped: false, breath: 1, action: null };
const cur = () => weapons[wp.i];
/** 재장전 중이면 남은 시간(HUD·자가 테스트 호환용) */
Object.defineProperty(wp, 'reloadT', { get: () => (wp.action && wp.action.name === 'reload' ? wp.action.dur - wp.action.t : 0) });
const busy = () => wp.switchT > 0 || (wp.action && wp.action.name !== 'inspect');

// ---------------------------------------------------------------- 무기 동작 타임라인
// 동작 하나 = { name, t, dur, rounds?, events: [[진행률, 함수], ...] }. 진행률을 지날 때 소리·탄피 배출이 일어난다.
function startAction(name, dur, extra = {}) {
  const w = cur(), id = w.def.id, ev = [];
  const brass = () => { weaponView.ejectCasing(); fx.debrisBurst('brass', _v.copy(player.eye).addScaledVector(right, .22).addScaledVector(fwd, .4).addScaledVector(up, -.06), 1, .4, 2.2, .035, 1.5, _v2.copy(right).multiplyScalar(2.4)); setTimeout(() => sfx('casing'), 420); };
  if (name === 'bolt') ev.push([.12, () => sfx('boltUp')], [.3, () => { sfx('boltBack'); brass(); }], [.56, () => sfx('boltFwd')], [.8, () => sfx('boltDown')]);
  else if (name === 'pump') ev.push([.3, () => { sfx('pumpBack'); brass(); }], [.66, () => sfx('pumpFwd')]);
  else if (name === 'inspect') ev.push([.15, () => sfx('cloth')], [.6, () => sfx(id === 'thompson' ? 'magOut' : id === 'trench' ? 'pumpBack' : 'boltBack')], [.78, () => sfx(id === 'thompson' ? 'magIn' : id === 'trench' ? 'pumpFwd' : 'boltFwd')]);
  else if (name === 'reload') {
    if (id === 'garand') ev.push([.08, () => sfx('boltBack')], [.35, () => sfx('cloth')], [.64, () => sfx('clipIn')], [.75, () => sfx('boltFwd')]);
    if (id === 'thompson') ev.push([.13, () => sfx('magOut')], [.36, () => sfx('cloth')], [.56, () => sfx('magIn')], [.7, () => sfx('boltBack')], [.8, () => sfx('boltFwd')]);
    if (id === 'trench') ev.push([.02, () => sfx('cloth')]);
    if (id === 'springfield') ev.push([.02, () => sfx('boltUp')], [.07, () => sfx('boltBack')], [.9, () => sfx('boltFwd')], [.96, () => sfx('boltDown')]);
  }
  wp.action = { name, t: extra.t0 || 0, dur, events: ev.filter(([p]) => p * dur > (extra.t0 || 0)), ...extra };
}
function updateAction(dt) {
  const a = wp.action; if (!a) return;
  const w = cur(), d = w.def, before = a.t; a.t = Math.min(a.dur, a.t + dt);
  for (const e of a.events) if (!e.done && a.t >= e[0] * a.dur) { e.done = true; e[1](); }
  if (a.name === 'reload' && d.load === 'single') {   // 한 발씩 들어간다 — 중간에 쏘면 넣은 만큼만 장전된 상태
    const per = d.reload, k = (t) => Math.floor(clamp((t - d.reloadOpen) / per, 0, a.rounds) + 1e-6);
    for (let n = k(before); n < k(a.t); n++) if (w.reserve > 0 && w.ammo < d.mag) { w.ammo++; w.reserve--; sfx(d.id === 'trench' ? 'shellIn' : 'roundIn'); }
  }
  if (a.t < a.dur) return;
  wp.action = null;
  if (a.name === 'reload') {
    if (d.load !== 'single') { const need = Math.min(d.mag - w.ammo, w.reserve); w.ammo += need; w.reserve -= need; }
    if (d.kind === 'pump' && a.emptyStart && w.ammo > 0) startAction('pump', d.cycle);   // 빈 약실 → 펌프로 한 발 올림
  }
  if (a.name === 'bolt' || a.name === 'pump') { if (w.ammo === 0 && w.reserve > 0) wp.autoReload = .25; }
}

// ---------------------------------------------------------------- 입력
const keys = {}; let mouseL = false, mouseR = false, firePressed = false, mouseNX = 0, mouseNY = 0, lockFailed = false;
const isLocked = () => document.pointerLockElement === canvas;
function setPaused(v) { state.paused = v; $('pause').style.display = v ? 'flex' : 'none'; if (v) { for (const k in keys) keys[k] = false; mouseL = mouseR = false; } else last = performance.now(); }
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'Escape' && state.mode === 'play' && !isLocked() && !e.repeat) { setPaused(!state.paused); return; }
  if (e.code === 'F8' && !e.repeat) { e.preventDefault(); const q = renderer.setQuality(renderer.quality === 'high' ? 'legacy' : 'high'); say(q === 'high' ? '그래픽: 5단계 개선' : '그래픽: 기존 (4단계)'); return; }
  if (keys[e.code]) return; keys[e.code] = true;
  if (state.mode !== 'play' || state.paused || player.dead) return;
  if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyG') throwGrenade();
  else if (e.code === 'Digit1') switchTo(0); else if (e.code === 'Digit2') switchTo(1); else if (e.code === 'Digit3') switchTo(2); else if (e.code === 'Digit4') switchTo(3);
  else if (e.code === 'KeyF') inspect();
  else if (e.code === 'KeyC') player.crouch = !player.crouch;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseL = mouseR = false; });
addEventListener('mousedown', (e) => { if (state.mode !== 'play' || state.paused) return; if (touch.enabled && e.target instanceof Element && e.target.closest('#touch')) return; if (e.button === 0) { mouseL = true; firePressed = true; } if (e.button === 2) { mouseR = true; if (cur().def.scope && !player.dead) toggleScope(); } });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (state.mode === 'play' && !state.paused && !player.dead) switchTo((wp.i + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); }, { passive: true });
addEventListener('mousemove', (e) => {
  mouseNX = (e.clientX / innerWidth - .5) * 2; mouseNY = (e.clientY / innerHeight - .5) * 2;
  if (state.mode !== 'play' || state.paused || player.dead) return;
  const s = 0.0022 * lerp(1, cur().def.zoom / 75, wp.ads);
  player.yaw -= e.movementX * s; player.pitch = clamp(player.pitch - e.movementY * s, -1.5, 1.5);
  wp.swayX = clamp(wp.swayX - e.movementX * .00012, -.03, .03); wp.swayY = clamp(wp.swayY + e.movementY * .00012, -.03, .03);
});

// ---------------------------------------------------------------- 터치 조작(아이패드): src/game/touch.js
const touch = createTouchControls({
  active: () => state.mode === 'play' && !state.paused && !player.dead,
  look: (dx, dy) => {
    const s = 0.0042 * lerp(1, cur().def.zoom / 75, wp.ads);
    player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.5, 1.5);
    wp.swayX = clamp(wp.swayX - dx * .00012, -.03, .03); wp.swayY = clamp(wp.swayY + dy * .00012, -.03, .03);
  },
  fire: (d) => { mouseL = d; if (d) firePressed = true; },
  aim: () => { if (player.dead) return; if (cur().def.scope) toggleScope(); else mouseR = !mouseR; },   // 터치는 누르고 있기 어려워 조준을 켜고 끈다
  reload: () => startReload(), grenade: () => throwGrenade(), crouch: () => { player.crouch = !player.crouch; },
  jump: (d) => { keys.Space = d; }, weapon: () => switchTo((wp.i + 1) % WEAPONS.length), pause: () => setPaused(true),
  state: () => ({ crouch: player.crouch, aim: cur().def.scope ? wp.scoped : mouseR }),
  onEnable: () => {
    // 아이패드 GPU 에 맞춰 내부 해상도를 낮게 시작(동적 해상도가 이어서 조절)
    renderer.prMax = Math.min(renderer.prMax, 1.5); renderer.prMin = .6; if (renderer.pixelRatio > 1.25) { renderer.gl.setPixelRatio(1.25); renderer.resize(); }
    queueMicrotask(touchTexts);   // 이 호출은 touch 가 만들어지는 도중일 수 있다
  },
});
/** 터치 기기에 맞는 안내 문구 */
function touchTexts() {
  if (!touch.enabled) return;
  const g = document.querySelector('#pause .go'); if (g) g.textContent = '탭하여 계속';
  const c = document.querySelector('#cine .go'); if (c) c.textContent = '탭하여 작전 개시';
  const k = document.querySelector('#cine .skip'); if (k) k.textContent = '건너뛰기 ▶';
}
/** 터치 조준 보조: 화면 가운데 가까이(약 3~4°)에 보이는 적이 있으면 시점을 그쪽으로 살짝 끌어 준다 */
function aimAssist(dt) {
  if (!touch.enabled || player.dead || !(touch.looking || mouseL || wp.ads > .5)) return;
  camera.getWorldDirection(fwd);
  let best = null, bestA = wp.ads > .5 ? .07 : .055;
  for (const e of enemies) {
    if (!e.alive || !e.los) continue;
    _v.set(e.x - player.eye.x, e.y + 1.2 - player.eye.y, e.z - player.eye.z); const d = _v.length(); if (d > 110 || d < .5) continue; _v.multiplyScalar(1 / d);
    const a = Math.acos(clamp(_v.dot(fwd), -1, 1)); if (a < bestA) { bestA = a; best = { yaw: Math.atan2(-_v.x, -_v.z), pitch: Math.asin(_v.y) }; }
  }
  if (!best) return;
  let dy = best.yaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const k = Math.min(1, dt * 2.6); player.yaw += dy * k; player.pitch = clamp(player.pitch + (best.pitch - player.pitch) * k * .6, -1.5, 1.5);
}
addEventListener('visibilitychange', () => { if (document.hidden && touch.enabled && state.mode === 'play' && !state.paused) setPaused(true); });

function switchTo(i) { if (i === wp.i || wp.switchT > 0 || i < 0 || i >= weapons.length) return; if (touch.enabled) mouseR = false; wp.next = i; wp.switchT = SWITCH_TIME; wp.action = null; wp.scoped = false; sfx('click'); }
function startReload() {
  const w = cur(), d = w.def; if (busy() || w.ammo >= d.mag || w.reserve <= 0) return;
  wp.scoped = false;
  if (d.load === 'single') { const n = Math.min(d.mag - w.ammo, w.reserve); startAction('reload', d.reloadOpen + n * d.reload + d.reloadClose, { rounds: n, emptyStart: w.ammo === 0 }); return; }
  if (d.load === 'clip' && w.ammo > 0) { w.reserve += w.ammo; w.ammo = 0; weaponView.ejectClip(); sfx('ping'); }   // 남은 클립은 튕겨내고 탄은 예비로
  startAction('reload', d.reload);
}
function inspect() { if (busy() || wp.action) return; wp.scoped = false; startAction('inspect', 2.4); }
function toggleScope() { if (busy() && !(wp.action && wp.action.name === 'bolt')) return; wp.scoped = !wp.scoped; if (wp.scoped) sfx('scopeIn'); }
function hitMark(kill, head) { const h = $('hit'); h.className = kill ? 'kill' : ''; hud.hitT = kill ? .32 : .16; hud.hitMax = hud.hitT; if (kill) sfx('kill'); else sfx(head ? 'head' : 'hit'); }
function flashScreen(a) { hud.flash = Math.max(hud.flash, a); }
function say(t, dur = 1.6) { $('msg').textContent = t; $('msg').style.opacity = 1; hud.msgT = dur; }
function banner(a, b, dur = 4) { $('banA').textContent = a; $('banB').textContent = b; $('banner').style.opacity = 1; hud.banT = dur; }
function damagePlayer(d, from) {
  if (player.dead || state.won || state.god) return;
  player.hp -= d; state.lastHurt = state.time; hud.vig = Math.min(1, hud.vig + .35 + d / 40); shake = Math.max(shake, .25 + d / 60); sfx('hurt');
  wp.recoil += rand(-.02, .03);
  if (player.hp <= 0) { player.hp = 0; player.dead = true; player.deadT = 0; mouseL = mouseR = false; }
}
function castShot(o, d, range) {
  if (shootDirty) { shootables = solids.slice(); for (const e of enemies) if (e.alive) shootables.push(...e.meshes); shootDirty = false; }
  _rc.set(o, d); _rc.near = 0; _rc.far = range; const h = _rc.intersectObjects(shootables, false)[0];
  const tt = terrainHit(o, d, h ? h.distance : range, .5);
  if (tt >= 0) return { type: 'terrain', point: new V3().copy(o).addScaledVector(d, tt) };
  if (h) return { type: h.object.userData.enemy ? 'enemy' : 'solid', point: h.point, enemy: h.object.userData.enemy, part: h.object.userData.part, object: h.object, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null };
  return { type: 'none', point: new V3().copy(o).addScaledVector(d, range) };
}
const fwd = new V3(), right = new V3(), up = new V3();
// 6단계: 맞은 물체의 재질 → 탄착 효과·소리 종류
const SURF = new Map([[materials.M.concrete, 'concrete'], [materials.M.concreteDark, 'concrete'], [materials.M.rust, 'metal'], [materials.M.steel, 'metal'], [materials.M.tank, 'metal'], [materials.M.boat, 'metal'], [materials.M.gun, 'metal'], [materials.M.crate, 'wood'], [materials.M.wood, 'wood'], [materials.M.woodDark, 'wood'], [materials.M.bag, 'sand']]);
const surfaceOf = (obj) => (obj && obj.userData.surface) || (obj && SURF.get(obj.material)) || 'concrete';
/** 탄착 한 번: 재질별 파편·연기·자국·소리. k = 세기(산탄 한 알 0.4) */
function bulletImpact(surface, point, normal, dir, k = 1, decalLife) {
  const n = normal || groundNormal(point.x, point.z);
  if (surface === 'sand' || surface === 'terrain') { const wet = point.y < .1 && point.z > 72; surface = wet ? 'water' : 'sand'; if (!wet && normal == null) fx.decal('hole', point, n, k < 1 ? .16 : .28, undefined, decalLife); }
  else if (normal) fx.decal('chip', point, n, k < 1 ? .08 : .14, undefined, 60);
  fx.impact(surface, point, n, dir, k);
  sfx('impact', surface, point);
}
/** 거리별 피해 배율 */
function falloff(def, dist) { if (!def.falloff) return 1; const [a, b, m] = def.falloff; return dist <= a ? 1 : dist >= b ? m : lerp(1, m, (dist - a) / (b - a)); }
const scopeK = () => (cur().def.scope ? clamp((wp.ads - .72) / .25, 0, 1) : 0);
function fire() {
  const w = cur(), def = w.def;
  if (wp.switchT > 0 || wp.cool > 0) return;
  if (wp.action) {   // 한 발씩 장전 중에는 쏘면 장전을 멈춘다(넣은 탄은 남음). 그 밖의 동작 중에는 쏠 수 없다
    if (!(wp.action.name === 'reload' && def.load === 'single' && w.ammo > 0 && firePressed)) { if (wp.action.name === 'inspect') wp.action = null; else return; }
    else if (def.kind === 'bolt') { startAction('bolt', def.cycle, { t0: def.cycle * .72 }); return; }   // 볼트를 닫고 나서 쏜다
    else wp.action = null;
  }
  if (w.ammo <= 0) { if (firePressed) { sfx('click'); if (w.reserve > 0) startReload(); else say('탄약 없음'); } return; }
  w.ammo--; wp.cool = def.cooldown; wp.lastFire = 0; state.shots++; state.grace = 0;
  camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize(); up.crossVectors(right, fwd);
  const spread = lerp(def.spread, def.adsSpread, wp.ads) * (1 + player.moveAmt * (def.scope ? 3 : .8)) * (player.crouch ? .75 : 1) * (1 + wp.heat);
  if (def.bloom) wp.heat = Math.min(1.5, wp.heat + def.bloom);
  const mz = new V3().copy(player.eye).addScaledVector(right, lerp(.16, 0, wp.ads)).addScaledVector(up, -.1).addScaledVector(fwd, .9);
  let anyHit = false, anyKill = false, anyHead = false; const d = new V3();
  for (let i = 0; i < def.pellets; i++) {
    d.copy(fwd).addScaledVector(right, gauss() * spread).addScaledVector(up, gauss() * spread).normalize();
    const r = castShot(player.eye, d, def.range);
    if (i < 4 && r.point.distanceToSquared(mz) > 64) fx.tracer(_v.copy(mz).addScaledVector(d, 4), r.point, false);
    if (r.type === 'enemy') { anyHit = true; if (r.part === 'head') anyHead = true; if (damageEnemy(r.enemy, def.dmg * falloff(def, r.point.distanceTo(player.eye)), r.part, d, def.knock, r.point)) anyKill = true; }
    else if (r.type === 'terrain') bulletImpact('terrain', r.point, null, d, def.pellets > 1 ? .4 : 1);
    else if (r.type === 'solid') bulletImpact(surfaceOf(r.object), r.point, r.normal, d, def.pellets > 1 ? .4 : 1);
  }
  if (anyHit) { state.hits++; hitMark(anyKill, anyHead); }
  sfx(def.sfx);
  // --- punch: recoil, shake, flash, light, brass
  wp.kick += def.kick; wp.kickRot += def.kick * 1.3; wp.recoil += def.rp * lerp(1, .7, wp.ads); if (!def.recoilReturn) player.yaw += gauss() * def.rp * .25; shake = Math.max(shake, def.shake * (1 - .6 * scopeK())); hud.fovPunch = def.shake * 5 * (1 - scopeK());
  if (def.scope) hud.scopeKick = 1;
  weaponView.fire(def.flash); lighting.muzzleFlash(mz, 140 * def.flash);
  fx.muzzle(def.id, mz, fwd); wp.smokeHeat = Math.min(2, (wp.smokeHeat || 0) + ({ thompson: .22, trench: .9, garand: .45, springfield: .7 }[def.id] || .4));
  if (def.kind === 'semi' || def.kind === 'auto') { weaponView.ejectCasing(); fx.debrisBurst('brass', _v.copy(player.eye).addScaledVector(right, .22).addScaledVector(fwd, .4).addScaledVector(up, -.08), 1, .4, 2.2, .035, 1.5, _v2.copy(right).multiplyScalar(2.4)); }
  if (def.kind === 'pump' || def.kind === 'bolt') startAction(def.kind, def.cycle);   // 다음 발을 위해 펌프·볼트 조작
  if (def.load === 'clip' && w.ammo === 0) wp.pingT = .06;                          // 개런드: 마지막 탄 → 클립 배출
  if (w.ammo === 0 && w.reserve > 0 && !wp.action) wp.autoReload = .35;
}
// grenades
const grenades = [];
function throwGrenade() {
  if (player.grenades <= 0) { say('수류탄 없음'); return; } player.grenades--; state.grace = 0;
  camera.getWorldDirection(fwd); const m = fx.grenadeMesh(_v.copy(player.eye).addScaledVector(fwd, .5));
  grenades.push({ m, v: new V3().copy(fwd).multiplyScalar(17).add(new V3(player.vel.x, 4.5, player.vel.z)), t: 2.6 }); sfx('click'); wp.kick += .06;
}

// ---------------------------------------------------------------- HUD
// ---------------------------------------------------------------- HUD
const hud = { hitT: 0, hitMax: 1, vig: 0, flash: 0, msgT: 0, banT: 0, fovPunch: 0, scopeKick: 0, cache: {} };
const scopeEl = $('scope'), breathBar = $('breathBar');
/** 스코프 화면: 조준 진행에 맞춰 나타나고, 사격 반동에 튀었다가 제자리로 돌아온다. */
function updateScopeOverlay(dt) {
  const k = state.mode === 'play' && !player.dead ? scopeK() : 0;
  hud.scopeKick = Math.max(0, hud.scopeKick - dt * 3.2);
  const kick = Math.sin(Math.min(1, hud.scopeKick) * Math.PI) * hud.scopeKick;
  scopeEl.style.opacity = k; scopeEl.style.setProperty('--ky', (kick * -46).toFixed(1) + 'px'); scopeEl.style.setProperty('--kx', (kick * 9).toFixed(1) + 'px');
  breathBar.style.width = (wp.breath * 100).toFixed(0) + '%'; breathBar.style.background = wp.breath < .25 ? '#c8342b' : '';
}
function setText(id, v) { if (hud.cache[id] !== v) { hud.cache[id] = v; $(id).textContent = v; } }
function updateHud(dt) {
  const w = cur(), alive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0), mgAlive = enemies.reduce((n, e) => n + (e.alive && e.type === 'mg' ? 1 : 0), 0);
  setText('hp', Math.ceil(player.hp)); $('hpfill').style.width = player.hp + '%'; $('hpfill').style.background = player.hp < 30 ? '#c8342b' : '';
  setText('mag', w.ammo); setText('res', w.reserve); setText('weapon', w.def.name + (wp.reloadT > 0 ? '  — 재장전 중' : wp.action && wp.action.name === 'bolt' ? '  — 볼트 조작' : wp.action && wp.action.name === 'pump' ? '  — 펌프' : ''));
  setText('grenades', '수류탄 ' + '●'.repeat(player.grenades) + '○'.repeat(Math.max(0, 3 - player.grenades)));
  const octx = { player, enemies, allies, stage: SM };
  if (state.mode === 'play' && !player.dead) objectives.update(octx, state.time);
  { const L = objectives.list(octx), html = L.map((o, i) => `<div class="${o.state}">${o.state === 'done' ? '✓' : i + 1 + '.'} ${o.text}${o.progress ? `<span class="pg">${o.progress}</span>` : ''}</div>`).join('');
    if (hud.cache.objList !== html) { hud.cache.objList = html; $('objList').innerHTML = html; } setText('objT', objectives.current ? objectives.current.text : '작전 완료'); }
  updateObjMarker(octx);
  setText('enT', SM ? SM.hud(octx) : `${alive}명 · 벙커 ${mgAlive}/3`); setText('alT', `아군 ${allies.reduce((n, a) => n + (a.alive ? 1 : 0), 0)}명`);
  hud.hitT = Math.max(0, hud.hitT - dt); const h = $('hit'); h.style.opacity = hud.hitT > 0 ? Math.min(1, hud.hitT / hud.hitMax * 1.6) : 0; h.style.transform = `scale(${1 + (hud.hitT / hud.hitMax) * .5})`;
  hud.vig = Math.max(0, hud.vig - dt * 1.1); $('vig').style.opacity = Math.min(1, hud.vig + (player.hp < 30 ? .35 + Math.sin(state.time * 6) * .12 : 0));
  hud.flash = Math.max(0, hud.flash - dt * 2.2); $('flash').style.opacity = hud.flash;
  if (hud.msgT > 0 && (hud.msgT -= dt) <= 0) $('msg').style.opacity = 0;
  if (hud.banT > 0 && (hud.banT -= dt) <= 0) $('banner').style.opacity = 0;
  $('cross').style.setProperty('--gap', (5 + lerp(w.def.spread, w.def.adsSpread, wp.ads) * 260 * (1 + player.moveAmt) + wp.kick * 60) + 'px'); $('cross').style.opacity = scopeK() > .1 ? 0 : wp.ads > .6 && wp.i === 0 ? .25 : 1;
  const slots = weapons.map((x, i) => `<div class="${i === wp.i ? 'on' : ''}"><kbd>${i + 1}</kbd>${x.def.name} ${x.ammo}/${x.reserve}</div>`).join('');
  if (hud.cache.slots !== slots) { hud.cache.slots = slots; $('slots').innerHTML = slots; }
}
/** 현재 목표 위치를 화면에 표시(화면 밖이면 가장자리에 붙인다) */
const _om = new V3();
function updateObjMarker(octx) {
  const el = $('objMarker'), cur = objectives.current, t = cur && cur.target ? cur.target(octx) : null;
  if (!t || state.mode !== 'play' || player.dead || scopeK() > .3) { el.style.opacity = 0; return; }
  _om.set(t.x, heightAt(t.x, t.z) + 1.6, t.z); const dist = Math.hypot(t.x - player.pos.x, t.z - player.pos.z);
  _om.project(camera); let x = _om.x, y = _om.y; const behind = _om.z > 1;
  if (behind) { x = -x; y = -y; }
  const m = Math.max(Math.abs(x), Math.abs(y)); if (behind || m > .92) { const k = .92 / Math.max(m, 1e-3); x *= k; y *= k; }
  el.style.left = ((x * .5 + .5) * innerWidth).toFixed(0) + 'px'; el.style.top = ((-y * .5 + .5) * innerHeight).toFixed(0) + 'px';
  el.style.opacity = dist < 4 ? .35 : .9; setText('objDist', Math.round(dist) + 'm');
}
function statsHtml() { const acc = state.shots ? Math.round(state.hits / state.shots * 100) : 0, t = Math.floor(state.time); return `사살 <b>${state.kills}</b> / ${enemies.length} &nbsp;·&nbsp; 아군 전과 <b>${state.allyKills}</b> &nbsp;·&nbsp; 명중률 <b>${acc}%</b> &nbsp;·&nbsp; 시간 <b>${Math.floor(t / 60)}분 ${t % 60}초</b>`; }

// ---------------------------------------------------------------- 갱신
/** 모래·진흙 위 발자국 (물속·바위 위는 남기지 않는다) */
function footprint(x, z, yaw, side, life = 30) {
  const gy = heightAt(x, z); if (gy < .05 || (z < -8 && z > -34)) return;
  const sx = Math.cos(yaw) * .13 * side, sz = -Math.sin(yaw) * .13 * side;
  fx.decal('foot', _v3.set(x + sx, heightAt(x + sx, z + sz), z + sz), groundNormal(x + sx, z + sz), .38, yaw, life);
}
function updatePlayer(dt) {
  const p = player;
  if (p.dead) { p.deadT += dt; p.eyeH = lerp(p.eyeH, .3, Math.min(1, dt * 5)); camera.rotation.z = lerp(camera.rotation.z, .9, Math.min(1, dt * 3)); if (p.deadT > 1.6 && state.mode === 'play') { state.mode = 'dead'; $('deadCode').textContent = `STAGE ${STAGE.id} · ${STAGE.title}`; $('deadStats').innerHTML = statsHtml(); $('dead').style.display = 'flex'; document.exitPointerLock?.(); } return; }
  if (DIFF.regen && p.hp < 100 && state.time - state.lastHurt > DIFF.regenDelay) p.hp = Math.min(100, p.hp + DIFF.regen * dt);   // 쉬면 체력이 천천히 찬다(Stage 2~5)
  const f = clamp((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touch.f, -1, 1), s = clamp((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.s, -1, 1);
  if (touch.sprint && mouseR) mouseR = false;   // 터치: 질주하면 조준을 푼다
  { let tx = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0), ty = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
    if (!isLocked() && !DEBUG && !touch.enabled) { const ex = Math.max(0, Math.abs(mouseNX) - .72) / .28, ey = Math.max(0, Math.abs(mouseNY) - .78) / .22; tx -= Math.sign(mouseNX) * ex * 1.3; ty -= Math.sign(mouseNY) * ey * .8; }
    const k = lerp(1, .5, wp.ads); p.yaw += tx * 2.1 * k * dt; p.pitch = clamp(p.pitch + ty * 1.3 * k * dt, -1.5, 1.5); }
  const ground = heightAt(p.pos.x, p.pos.z), inWater = ground < -.25;
  p.sprinting = !!(keys.ShiftLeft || keys.ShiftRight || touch.sprint) && f > 0 && !p.crouch && !(mouseR && !cur().def.scope) && !wp.scoped && wp.lastFire > .25 && !wp.action;
  if (p.sprinting === false && (keys.ShiftLeft || keys.ShiftRight) && p.crouch && f > 0) p.crouch = false;
  let sp = p.crouch ? 2.3 : p.sprinting ? 7.6 : 4.7; if (inWater) sp *= .62; if (wp.ads > .5) sp *= cur().def.scope ? .35 : .6;
  let wx = -Math.sin(p.yaw) * f + Math.cos(p.yaw) * s, wz = -Math.cos(p.yaw) * f - Math.sin(p.yaw) * s; const wl = Math.hypot(wx, wz); if (wl > 0) { const m = Math.min(1, Math.max(Math.abs(f), Math.abs(s)) * 1.15); wx *= sp * m / wl; wz *= sp * m / wl; }   // 조이스틱은 민 만큼만 빠르게
  const acc = Math.min(1, dt * (p.onGround ? 11 : 2.5)); p.vel.x = lerp(p.vel.x, wx, acc); p.vel.z = lerp(p.vel.z, wz, acc);
  if (keys.Space && p.onGround) { p.vel.y = 5.2; p.onGround = false; if (p.crouch) p.crouch = false; }
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
  pushOut(p.pos, .42, p.pos.y, p.crouch ? 1.1 : 1.75);
  p.pos.x = clamp(p.pos.x, PBOX.minX, PBOX.maxX); p.pos.z = clamp(p.pos.z, PBOX.minZ, PBOX.maxZ);
  const g2 = heightAt(p.pos.x, p.pos.z); p.vel.y -= 16 * dt; p.pos.y += p.vel.y * dt;
  if (p.pos.y <= g2) { if (!p.onGround && p.vel.y < -4) { shake = Math.max(shake, .18); sfx('step', inWater); } p.pos.y = g2; p.vel.y = 0; p.onGround = true; } else if (p.pos.y > g2 + .15) p.onGround = false;
  const hs = Math.hypot(p.vel.x, p.vel.z); p.moveAmt = clamp(hs / 5, 0, 1.5);
  if (p.onGround && hs > .8) { const before = Math.floor(p.walkT / Math.PI); p.walkT += dt * (4.5 + hs * 1.25); if (Math.floor(p.walkT / Math.PI) !== before) { sfx('step', inWater); footprint(p.pos.x, p.pos.z, p.yaw + Math.PI, (p.footSide = -(p.footSide || 1))); } }
  p.eyeH = lerp(p.eyeH, p.crouch ? 1.05 : 1.7, Math.min(1, dt * 12));
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) { const k = pickups[i]; k.t += dt; k.g.rotation.y = k.t * 1.6; k.g.position.y = k.y + Math.sin(k.t * 3) * .07;
    if (Math.hypot(k.x - p.pos.x, k.z - p.pos.z) < 1.3 && Math.abs(k.y - p.pos.y) < 2.2) {
      if (k.type === 'med') { if (p.hp >= 100) continue; p.hp = Math.min(100, p.hp + 35); say('구급상자 +35'); }
      else { weapons[0].reserve += 24; weapons[1].reserve += 60; weapons[2].reserve += 12; if (p.grenades < 3) p.grenades++; say('탄약 보급'); }
      sfx('pickup'); renderer.scene.remove(k.g); pickups.splice(i, 1); } }
}
function updateWeapon(dt) {
  const w = cur(), def = w.def;
  wp.cool -= dt; wp.lastFire += dt; wp.heat = Math.max(0, wp.heat - dt * 2.5);
  // 총구 연기: 여러 발 쏜 뒤 총열에서 가는 연기가 피어오른다
  wp.smokeHeat = Math.max(0, (wp.smokeHeat || 0) - dt * .9);
  if (wp.smokeHeat > .5 && wp.lastFire > .12 && scopeK() < .5 && (wp.wispT = (wp.wispT || 0) - dt) <= 0) { wp.wispT = .07; camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize(); fx.wisp(_v.copy(player.eye).addScaledVector(right, lerp(.16, .02, wp.ads)).addScaledVector(camera.up, lerp(-.08, -.03, wp.ads)).addScaledVector(fwd, .75)); }
  if (wp.pingT > 0 && (wp.pingT -= dt) <= 0) { sfx('ping'); weaponView.ejectClip(); fx.debrisBurst('brass', _v.copy(player.eye).addScaledVector(right, .2).addScaledVector(fwd, .7), 1, .3, 3.2, .035, 1.5); }
  if (wp.autoReload > 0 && (wp.autoReload -= dt) <= 0 && w.ammo === 0) startReload();
  if (wp.switchT > 0) { wp.switchT -= dt; if (wp.next >= 0 && wp.switchT <= SWITCH_TIME / 2) { wp.i = wp.next; wp.next = -1; weaponView.setActive(wp.i); wp.autoReload = 0; wp.action = null; } }
  updateAction(dt);
  const W2 = cur();
  if (!player.dead && (W2.def.auto ? mouseL : firePressed)) fire();
  firePressed = false;
  // 조준: 일반 무기는 우클릭을 누르고 있는 동안, 저격총은 우클릭으로 켜고 끈다
  if (player.dead || player.sprinting || wp.switchT > 0 || (wp.action && wp.action.name !== 'bolt')) wp.scoped = false;
  const canAds = !player.sprinting && !wp.action && wp.switchT <= 0 && !player.dead;
  const adsWant = W2.def.scope ? (wp.scoped ? 1 : 0) : (mouseR && canAds ? 1 : 0);
  wp.ads = lerp(wp.ads, adsWant, Math.min(1, dt * (W2.def.scope ? 9 : 14)));
  // 숨 참기(스코프 중 Shift): 흔들림이 줄고, 숨이 바닥나면 크게 흔들린다
  const holding = wp.scoped && (keys.ShiftLeft || keys.ShiftRight) && wp.breath > 0;
  wp.breath = clamp(wp.breath + (holding ? -dt / 4 : dt / 3), 0, 1); wp.holdingBreath = holding;
  if (holding && !wp.wasHolding) sfx('breathIn'); if (!holding && wp.wasHolding) sfx('breathOut'); wp.wasHolding = holding;
  wp.kick *= Math.exp(-dt * 13); wp.kickRot *= Math.exp(-dt * 11); wp.recoil *= Math.exp(-dt * (W2.def.recoilReturn ? 6 : 9));
  if (!W2.def.recoilReturn) player.pitch = clamp(player.pitch + wp.recoil * dt * 3.2, -1.5, 1.5);
  wp.swayX *= Math.exp(-dt * 9); wp.swayY *= Math.exp(-dt * 9);
  // 자세(보이는 부분)는 WeaponManager 가 그린다
  const a = wp.action;
  weaponView.update(dt, { ads: wp.ads, kick: wp.kick, kickRot: wp.kickRot, swayX: wp.swayX, swayY: wp.swayY, walkT: player.walkT, moveAmt: player.moveAmt,
    switchT: wp.switchT, switchDur: SWITCH_TIME, sprinting: player.sprinting, sinceFire: wp.lastFire, ammo: W2.ammo,
    action: a ? { name: a.name, p: a.t / a.dur, rounds: a.rounds } : null, hidden: scopeK() > .95 });
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) { const g = grenades[i]; g.t -= dt; g.v.y -= 15 * dt; _v.copy(g.m.position); g.m.position.addScaledVector(g.v, dt);
    if (insideCollider(g.m.position)) { g.m.position.copy(_v); g.v.x *= -.35; g.v.z *= -.35; }
    const h = groundBelow(g.m.position.x, g.m.position.z, g.m.position.y) + .07; if (g.m.position.y < h) { g.m.position.y = h; g.v.y = Math.abs(g.v.y) * .32; g.v.x *= .62; g.v.z *= .62; }   // 지하 벙커 위에 떨어진 수류탄은 덮인 땅 위에 머문다
    if (g.t <= 0) { explode(g.m.position, 7.5, 110, true); fx.remove(g.m); grenades.splice(i, 1); } }
}
const pendingShells = []; const smokers = env.smokeSources; let smokeT = 0;
/** 전차 잔해에서 너울거리는 불꽃(5단계 그래픽에서만) */
function fireFx(x, z) { for (let i = 0; i < 2; i++) fx.sprite('flash', _v.set(x + rand(-.7, .7), heightAt(x, z) + 1.3 + rand(0, .4), z + rand(-.9, .9)), { size: rand(.5, .9), grow: 1.2, life: rand(.25, .45), alpha: .8, color: 0xff6a20, rise: 1.6 }); }
/** 스테이지 모듈이 쓰는 도구들 */
const timers = [];
const stageApi = { explode: (...a) => explode(...a), sfx: (...a) => sfx(...a), say: (...a) => say(...a), banner: (...a) => banner(...a), fx, env, player, V3, rand, later: (t, fn) => timers.push({ t, fn }),
  damageEnemy: (...a) => damageEnemy(...a), losClear, heightAt, pushOut, Enemy, Ally, allies, enemies, lighting, characters, camera };
function updateWorld(dt) {
  for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  if (SM) { SM.update(dt, stageApi, { player, enemies, allies, stage: SM }); }
  state.artT -= dt;
  if (!SM && state.artT <= 0) { state.artT = rand(2.2, 6);
    let x, z, tries = 0; do { x = clamp(player.pos.x + rand(-38, 38), -64, 64); z = rand(2, 70); tries++; } while (Math.hypot(x - player.pos.x, z - player.pos.z) < (state.grace > 0 ? 16 : 6.5) && tries < 8);
    const pos = new V3(x, Math.max(0, heightAt(x, z)), z); pendingShells.push({ pos, t: 1.05 }); sfx('whistle', pos); }
  for (let i = pendingShells.length - 1; i >= 0; i--) { const s = pendingShells[i]; if ((s.t -= dt) <= 0) { explode(s.pos, 6.5, 70, false); pendingShells.splice(i, 1); } }
  state.reinT -= dt;
  if (!SM && state.reinT <= 0) { state.reinT = 22;
    for (let i = allies.length - 1; i >= 0; i--) if (!allies[i].alive && allies[i].deadT > 30) allies.splice(i, 1);
    if (!state.won && allies.reduce((n, a) => n + (a.alive ? 1 : 0), 0) < 7) { for (const bx of [-34, 0, 31]) new Ally(bx + rand(-1, 1), 79.5 + rand(-.8, .8)); say('증원 병력 상륙'); } }
  state.distT -= dt; if (state.distT <= 0) { state.distT = rand(.25, 1.6); sfx('distant'); }
  smokeT -= dt; if (smokeT <= 0) { smokeT = .22; for (const [x, z] of smokers) fx.sprite('smoke', _v.set(x + rand(-.6, .6), heightAt(x, z) + 2.2, z + rand(-.6, .6)), { size: 1.6, grow: 4.5, life: 5.5, alpha: .6, color: 0x1e1c1a, rise: 2.4, vx: 1.2 }); 
    if (renderer.quality === 'high') for (const [x, z] of smokers) fireFx(x, z); }
}

// ---------------------------------------------------------------- 메인 루프
let last = performance.now(), lastRaf = last;
function frame(now) { requestAnimationFrame(frame); lastRaf = performance.now(); tick(now); }
function tick(now) {
  if (now <= last) return;
  renderer.adapt(now - last);   // 동적 해상도(60fps 유지)
  touch.update();
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const live = state.mode === 'play' && !state.paused;
  if (live) {
    state.time += dt; state.grace -= dt;
    updatePlayer(dt); aimAssist(dt); updateWeapon(dt); if (DIFF.checkpoint) noteCheckpoint();
    for (const e of enemies) { characters.lod(e, camera.position); e.update(dt); }
    for (const a of allies) { characters.lod(a, camera.position); a.update(dt); }
    fx.update(dt, heightAt); updateGrenades(dt); updateWorld(dt); updateHud(dt);
    if (state.won && state.mode === 'play' && (state.winT -= dt) <= 0) { document.exitPointerLock?.(); playCine('outro', () => { state.mode = 'win'; showStageComplete(); }); }
  } else if (state.mode === 'cine') {   // 시네마틱: 전투는 멈추고 병사는 제자리 동작, 연기·물결은 계속
    state.time += dt; cine.update(dt); fx.update(dt, heightAt);
    for (const c of [...enemies, ...allies]) if (c.anim && c.alive) { characters.lod(c, camera.position); c.anim.update(dt, { speed: 0 }); }
    smokeT -= dt; if (smokeT <= 0) { smokeT = .22; for (const [x, z] of smokers) fx.sprite('smoke', _v.set(x + rand(-.6, .6), heightAt(x, z) + 2.2, z + rand(-.6, .6)), { size: 1.6, grow: 4.5, life: 5.5, alpha: .6, color: 0x1e1c1a, rise: 2.4, vx: 1.2 }); if (renderer.quality === 'high') for (const [x, z] of smokers) fireFx(x, z); }
  } else if (state.mode === 'menu') { state.time += dt; player.yaw = Math.sin(state.time * .12) * .35; fx.update(dt, heightAt); smokeT -= dt; if (smokeT <= 0) { smokeT = .22; for (const [x, z] of smokers) fx.sprite('smoke', _v.set(x, heightAt(x, z) + 2.2, z), { size: 1.6, grow: 4.5, life: 5.5, alpha: .6, color: 0x1e1c1a, rise: 2.4, vx: 1.2 }); } }
  // 카메라
  shake *= Math.exp(-dt * 7.5);
  player.eye.set(player.pos.x, player.pos.y + player.eyeH + (player.onGround ? Math.abs(Math.cos(player.walkT)) * .035 * Math.min(1, player.moveAmt) : 0), player.pos.z);
  camera.position.copy(player.eye); camera.position.x += gauss() * shake * .06; camera.position.y += gauss() * shake * .06;
  const sk = scopeK(), sway = sk * (wp.holdingBreath ? .15 : 1 + (1 - wp.breath) * 2.5) * .0035, st = state.time;
  const shk = shake * (1 - .7 * sk);
  camera.rotation.y = player.yaw + gauss() * shk * .008 + Math.sin(st * .9) * sway; camera.rotation.x = player.pitch + wp.recoil * (cur().def.recoilReturn ? .35 : .5) + gauss() * shk * .012 + Math.sin(st * 1.8) * sway * .6; if (!player.dead) camera.rotation.z = gauss() * shake * .012 + Math.sin(player.walkT) * .004 * player.moveAmt;
  hud.fovPunch *= Math.exp(-dt * 12);
  renderer.setFov(lerp(75, cur().def.zoom, wp.ads) + (player.sprinting ? 5 : 0) + hud.fovPunch, dt);
  if (state.mode === 'cine') { camera.position.copy(cine.pos); camera.lookAt(cine.look); renderer.setFov(cine.fov, 1); }   // 시네마틱 카메라
  lighting.update(dt, state.mode === 'cine' ? cine.focus : player.pos); env.update(state.time, camera.position);
  updateScopeOverlay(dt);
  renderer.render(now / 1000, { viewModel: state.mode !== 'menu' && state.mode !== 'cine' && !player.dead && scopeK() < .95 });
}
requestAnimationFrame(frame);
// 디버그 전용: 창이 숨겨져 브라우저가 화면 갱신(rAF)을 멈춰도 자가 테스트가 진행되도록 타이머로 대신 돌린다.
if (DEBUG) setInterval(() => { const now = performance.now(); if (now - lastRaf > 200) tick(now); }, 16);

// ---------------------------------------------------------------- 진행 흐름
assets.whenReady().then((rep) => {
  assetsReady = true; if (goLabel) goLabel.textContent = '작전 지도 열기';
  if (state.mode === 'menu' && !PARAMS.has('selftest')) { if (PARAMS.has('brief')) showBriefing(STAGE.id); else showCampaign(); }
  if (rep.failures || rep.warnings.length) {
    const note = $('assetNote');
    if (note) note.textContent = `에셋 ${rep.failures}개를 불러오지 못해 기본 모델로 대체했습니다` + (rep.warnings.length ? ` · 텍스처 누락 ${rep.warnings.length}건` : '');
    console.warn('[AssetManager] 로딩 보고서', rep);
  }
});

// ---------------------------------------------------------------- flow
function lock() { if (DEBUG || touch.enabled) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignored */ } }
function startGame({ audio = true } = {}) {
  if (!assetsReady || state.mode !== 'menu') return false;
  if (audio) initAudio();
  for (const id of ['start', 'campaign', 'briefing']) { const el = $(id); el.style.display = 'none'; el.classList.remove('on'); }
  $('hud').style.display = 'block'; state.mode = 'play'; state.time = 0; lock();
  setText('objStage', `STAGE ${STAGE.id} · ${STAGE.code}`);
  banner(`${STAGE.dateShort} — ${STAGE.title}`, STAGE.objectives[0], 4.5);
  return true;
}

// ---------------------------------------------------------------- 캠페인 화면 (작전 지도 · 브리핑 · 스테이지 완료)
/** 다른 스테이지로 가거나 작전 지도로 돌아갈 때는 다시 불러온다(전장이 스테이지마다 다르므로). 디버그 플래그는 유지 */
function goto(params) { const q = new URLSearchParams(params); for (const k of ['debug', 'unlockall', 'pr']) if (PARAMS.has(k)) q.set(k, PARAMS.get(k)); location.href = location.pathname + '?' + q.toString(); }
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function showScreen(id) { $('start').style.display = 'none'; for (const s of ['campaign', 'briefing']) $(s).classList.toggle('on', s === id); }
function showCampaign() {
  $('campTitle').textContent = CAMPAIGN.title; $('campSub').textContent = `${CAMPAIGN.subtitle} · ${CAMPAIGN.unit}`;
  $('timeline').innerHTML = STAGES.map((s) => {
    const done = campaign.isCompleted(s.id), open = campaign.isUnlocked(s.id), cls = !open ? 'locked' : !s.built ? 'soon' : done ? 'done' : 'open';
    const rec = campaign.record(s.id), st = cls === 'locked' ? '🔒 잠김 — 이전 스테이지를 완료하라' : cls === 'soon' ? '해금됨 · 개발 중' : done ? `✓ 완료 ${rec && rec.clears > 1 ? `(${rec.clears}회)` : ''}` : '▶ 출격 가능';
    const img = s.built ? `background-image:url(./assets/ui/stage${s.id}.jpg)` : '';
    return `<div class="card ${cls}" data-id="${s.id}"><div class="dot">${s.id}</div><div class="img" style="${img}">${s.built ? '' : '<div class="ph">' + esc(s.code) + '</div>'}</div>
      <div class="body"><div class="code">STAGE ${s.id} · ${esc(s.code)}</div><div class="ttl">${esc(s.title)}</div><div class="meta">${esc(s.date)}<br>${esc(s.location)}</div><div class="st">${st}</div></div></div>`;
  }).join('');
  const n = STAGES.filter((s) => campaign.isCompleted(s.id)).length;
  $('campNote').textContent = `완료 ${n} / ${STAGES.length}` + (campaign.allComplete ? ' — 캠페인 1부 완료' : '');
  showScreen('campaign');
}
function showBriefing(id) {
  const s = stageById(id);
  $('brCode').textContent = `STAGE ${s.id} · ${s.code} — ${s.op}`; $('brTitle').textContent = s.title; $('brMeta').textContent = `${s.date} · ${s.location}`;
  $('brHistory').textContent = s.history; $('brMission').textContent = s.mission;
  $('brObjectives').innerHTML = s.objectives.map((o) => `<li>${esc(o)}</li>`).join('');
  const ready = s.id === STAGE.id && assetsReady; $('brGo').disabled = !ready; $('brNote').textContent = ready ? '' : '전장 불러오는 중…';
  showScreen('briefing');
}
$('timeline').addEventListener('click', (e) => {
  const c = e.target.closest('.card'); if (!c) return; const id = +c.dataset.id, s = stageById(id);
  if (!campaign.isUnlocked(id) || !s.built) return;
  if (id === STAGE.id) showBriefing(id); else goto({ stage: id, brief: 1 });
});
$('campReset').addEventListener('click', () => { if (confirm('캠페인 진행 기록(해금·완료)을 모두 지울까요?')) { campaign.reset(); showCampaign(); } });
$('brGo').addEventListener('click', () => beginStage());
/** 브리핑 → 인트로 시네마틱 → 전투. 인트로가 저절로 끝나면 '작전 개시' 클릭(마우스 고정은 클릭에서만 요청 가능) */
function beginStage() {
  if (!assetsReady || state.mode !== 'menu') return;
  initAudio();
  if (touch.enabled && !DEBUG) { const d = document.documentElement, fs = d.requestFullscreen || d.webkitRequestFullscreen; try { const r = fs && fs.call(d); if (r && r.catch) r.catch(() => {}); } catch (_) { /* 전체 화면을 지원하지 않는 기기 */ } }
  touchTexts();
  playCine('intro', () => { state.mode = 'menu'; startGame(); }, { waitForClick: !DEBUG });
}
/** 시네마틱 재생. 자가 테스트·?nocine 이거나 대본이 없으면 바로 done */
function playCine(kind, done, opts = {}) {
  const make = CINEMATICS[STAGE.id] && CINEMATICS[STAGE.id][kind];
  if (!make || PARAMS.has('selftest') || PARAMS.has('nocine')) { done(false); return; }
  for (const id of ['start', 'campaign', 'briefing']) { const el = $(id); el.style.display = 'none'; el.classList.remove('on'); }
  $('hud').style.display = 'none'; state.mode = 'cine'; cine.play(make(STAGE), done, opts);
}
$('brBack').addEventListener('click', () => showCampaign());
$('start').addEventListener('click', () => { if (assetsReady && state.mode === 'menu') showCampaign(); });
function showStageComplete() {
  const res = campaign.complete(STAGE.id, { kills: state.kills, time: Math.floor(state.time), acc: state.shots ? Math.round(state.hits / state.shots * 100) : 0 });
  $('winCode').textContent = `STAGE ${STAGE.id} · ${STAGE.code}`; $('winTitle').textContent = '작전 성공';
  $('winStats').innerHTML = statsHtml(); $('winOutro').textContent = STAGE.outro; $('winNext').textContent = STAGE.next;
  const nxt = res.unlockedNext ? stageById(res.unlockedNext) : null, nb = $('winNextBtn');
  nb.style.display = nxt ? '' : 'none'; if (nxt) { nb.disabled = !nxt.built; nb.textContent = nxt.built ? `STAGE ${nxt.id} · ${nxt.title}` : `STAGE ${nxt.id} 해금됨 · 개발 중`; }
  if (SM && SM.endScreen) SM.endScreen($);   // 마지막 스테이지: 캠페인 1부의 끝 화면
  $('win').style.display = 'flex';
}
$('pause').addEventListener('click', () => { setPaused(false); lock(); });
// 이어 하기(체크포인트, Stage 2~5): 목표를 하나 끝낼 때마다 그 자리를 기억해 두고, 전사하면 거기서 체력·탄약을 채워 다시 시작한다.
// 적과 목표 진행은 그대로 남는다(쓰러뜨린 적은 다시 나오지 않음)
const checkpoint = { x: player.pos.x, y: 0, z: player.pos.z, yaw: player.yaw, obj: undefined };
function noteCheckpoint() {
  if (player.dead || !player.onGround || objectives.current === checkpoint.obj) return;
  checkpoint.obj = objectives.current; Object.assign(checkpoint, { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });
}
function revive() {
  if (state.mode !== 'dead') return;
  $('dead').style.display = 'none';
  Object.assign(player, { dead: false, deadT: 0, hp: 100, crouch: false, eyeH: 1.7, pitch: .02, yaw: checkpoint.yaw, onGround: true });
  player.pos.set(checkpoint.x, checkpoint.y, checkpoint.z); player.vel.set(0, 0, 0); camera.rotation.z = 0;
  for (const w of weapons) w.reserve = Math.max(w.reserve, w.def.reserve);
  player.grenades = Math.max(player.grenades, 2);
  Object.assign(wp, { action: null, scoped: false, switchT: 0, next: -1 });
  state.grace = DIFF.grace; state.lastHurt = -9; state.revives = (state.revives || 0) + 1; hud.vig = 0;
  mouseL = mouseR = false; for (const k in keys) keys[k] = false;
  state.mode = 'play'; last = performance.now(); lock();
  banner('이어서 작전 계속', objectives.current ? objectives.current.text : '', 3);
}
$('deadCont').style.display = DIFF.checkpoint ? '' : 'none';
if (!DIFF.checkpoint) { $('deadRetry').classList.add('main'); $('deadRetry').classList.remove('ghost'); $('deadRetry').textContent = '재도전'; }
$('deadCont').addEventListener('click', () => revive());
$('deadRetry').addEventListener('click', () => goto({ stage: STAGE.id, brief: 1 }));
$('deadMap').addEventListener('click', () => goto({}));
$('winNextBtn').addEventListener('click', () => { const n = STAGE.id + 1; if (stageById(n).built) goto({ stage: n, brief: 1 }); });
$('winMap').addEventListener('click', () => goto({}));
$('winAgain').addEventListener('click', () => goto({ stage: STAGE.id, brief: 1 }));
document.addEventListener('pointerlockchange', () => {
  if (DEBUG || state.mode !== 'play') return;
  setPaused(!isLocked());
});
document.addEventListener('pointerlockerror', () => { if (!lockFailed && state.mode === 'play') say('마우스 고정 불가 — 커서를 화면 가장자리로 옮기거나 방향키로 회전', 6); lockFailed = true; });
canvas.addEventListener('click', () => { if (state.mode === 'play' && !DEBUG && !lockFailed && !isLocked()) lock(); });

if (DEBUG) window.__game = {
  allies, player, enemies, state, weapons, wp, pickups, grenades, keys, startGame, castShot, isAssetsReady: () => assetsReady, WEAPONS, toggleScope, inspect, scopeK, falloff, heightAt, explode, damageEnemy, damagePlayer, V3, switchTo, startReload, throwGrenade, statsHtml,
  fire: () => { firePressed = true; }, hold: (v) => { mouseL = v; }, DIFF, checkpoint, revive,
  assets, renderer, lighting, env, fx, characters, weaponView, audio, surfaceOf, bulletImpact, campaign, objectives, STAGE, STAGE_MODULE: SM, showCampaign, showBriefing, cine, playCine, beginStage,
};
if (PARAMS.has('selftest')) import('./src/debug/selftest.js').then((m) => m.runSelfTest(window.__game)).catch((e) => console.error('[selftest]', e));
