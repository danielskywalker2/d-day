// Stage 4 — 파리 해방(LIBERATION OF PARIS) 게임 규칙: 레지스탕스 접선, 검문소, 점령 건물, 민간인 구출, 광장·구청 점령.
// 민간인은 적과 다른 존재다: 사격 판정(피격 부위)이 없고 적의 표적도 아니며, 공격해서 얻는 점수·보상도 없다. 구출만이 목표다.
import { TERRAIN4 } from './stage4/terrain.js';
import { ParisEnvironment } from './stage4/ParisEnvironment.js';
import { ENEMY_BOX, PLAYER_BOX, OCCUPIED, BACK_ROOM, CAFE, CHECKPOINT, SAFE, SQUARE, HALL, EVAC_PATH, WINDOW_SNIPERS, STREET_H } from './stage4/layout.js';
import { heightAt, pushOut } from '../game/world.js';

const near = (p, list) => { let best = null, bd = 1e9; for (const t of list) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return best; };
const alive = (c, f) => c.enemies.filter((e) => e.alive && f(e));
const inBox = (p, B) => p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ;
const inOccupied = (p) => p.x > OCCUPIED.x0 + .3 && p.x < OCCUPIED.x1 - .3 && p.z > OCCUPIED.z0 + .3 && p.z < OCCUPIED.z1 - .3;
const HALL_DOOR = { x: 0, z: -92.6 };
const CIV_TINTS = [[1.15, 1.3, 1.6], [1.55, 1.5, 1.4], [1.5, .62, .55], [1.55, 1.3, .7], [1.0, 1.3, 1.1], [1.4, 1.0, 1.35]];   // 사복 색(하늘색·흰색·빨강·노랑·연두·분홍)

/** 민간인: 총·철모가 없는 사복 차림. 숨음(웅크림) → 대피(안전지대까지 정해진 길) → 안전. 피격 판정 없음. */
class Civilian {
  constructor(characters, x, z, tint, k) {
    Object.assign(this, { x, z, y: heightAt(x, z), yaw: Math.PI * .5 + k, state: 'hide', i: 0, k, alive: true, civilian: true, delay: k * .7 });
    characters.create(this, 'american', { look: 'civilian', tint });
  }
  update(dt, api) {
    let speed = 0, face = null;
    if (this.state === 'flee' && (this.delay -= dt) <= 0) {
      const fin = this.i >= EVAC_PATH.length, w = fin ? [SAFE.x - 1 - (this.k % 3) * 1.6, SAFE.z + (this.k % 2 ? 1.6 : -1.6)] : EVAC_PATH[this.i];
      const dx = w[0] - this.x, dz = w[1] - this.z, d = Math.hypot(dx, dz);
      if (d < .45) { if (fin) { this.state = 'safe'; } else this.i++; }
      else { const sp = 3.6, v = new api.V3(this.x + dx / d * sp * dt, 0, this.z + dz / d * sp * dt); pushOut(v, .3, this.y, 1.7); this.x = v.x; this.z = v.z; this.y = heightAt(this.x, this.z); speed = sp; face = Math.atan2(dx, dz); }
    }
    if (this.state === 'safe' || this.state === 'cheer') { const P = api.player.pos; face = Math.atan2(P.x - this.x, P.z - this.z); }
    if (face !== null) { let dy = face - this.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; this.yaw += dy * Math.min(1, dt * 7); }
    this.group.rotation.y = this.yaw; this.group.position.set(this.x, this.y, this.z);
    if (this.anim) { api.characters.lod(this, api.camera.position); this.anim.update(dt, { speed, crouch: this.state === 'hide', aiming: false, pitch: 0 }); }
  }
}

export default {
  id: 4,
  terrain: TERRAIN4,
  Env: ParisEnvironment,
  ambience: 'field',
  playerStart: { x: 0, z: 102, yaw: 0 },
  enemyBox: ENEMY_BOX, allyBox: PLAYER_BOX, playerBox: PLAYER_BOX,
  winDelay: 7, winText: ' — 파리 해방',
  state: { contact: false, entered: false, found: false, evac: false, hold: 0, ffi: [], civ: [], flagT: -1, bellT: 0, said: {} },

  spawn(api) {
    const { Enemy, Ally, addPickup, V3, characters } = api, S = this.state, E = (type, x, z, zone, o = {}) => { const e = new Enemy(type, x, z, o.muzzle, o); e.zone = zone; return e; };
    const H = STREET_H, cz = CHECKPOINT.z;
    // 검문소: MG42(모래주머니, 남쪽을 향함) + 소총수·기관단총 + 2층 발코니 저격수 2명
    E('mg', -4, cz - 3.9, 'checkpoint', { holdPos: true, muzzle: new V3(-4, H + 1.05, cz - 1.7) });
    for (const [t, x, z] of [['rifle', -5, cz + 1.6], ['rifle', 4, cz - 3.4], ['smg', 2, cz + 6.6], ['rifle', 6.2, cz - 7], ['smg', -1, cz - 10]]) E(t, x, z, 'checkpoint');
    for (const W of WINDOW_SNIPERS) E('sniper', W.x, W.z, 'checkpoint', { fixedY: W.y });
    // 점령 건물 1층(홀·옆방·창고)
    for (const [t, x, z, hold] of [['smg', 15, 6, false], ['rifle', 17, -1, true], ['rifle', 27, 6, true], ['smg', 14, -11, false]]) E(t, x, z, 'building', { holdPos: hold });
    // 서쪽 골목(안전지대 자리)을 지키는 2명
    E('rifle', -35, 8.6, 'alley', { holdPos: true }); E('smg', -39, 11.4, 'alley', { holdPos: true });
    // 광장: 가운데 MG42 진지, 모래주머니 벽 뒤의 병사들, 구청 앞
    E('mg', 0, -70.6, 'square', { holdPos: true, muzzle: new V3(0, H + 1.05, -67.7) });
    for (const [t, x, z] of [['rifle', -22, -61.4], ['rifle', 24, -79.4], ['smg', -31, -51.4], ['smg', 31, -53.4], ['rifle', -6, -86], ['rifle', 6, -86], ['smg', 0, -89.5], ['rifle', -40, -70], ['rifle', 40, -64]]) E(t, x, z, 'square');
    // 아군: 미군 2명(함께 출발) + 카페의 레지스탕스 3명(접선 전까지 대기)
    for (const [x, z] of [[-3, 103], [3, 104]]) new Ally(x, z);
    for (const [x, z, w, t] of [[-11, 58.6, 'garand', [1.1, .85, .6]], [-12.2, 63, 'smg', [.8, .85, .95]], [-10.6, 61.4, 'garand', [1.2, 1.0, .75]]]) { const a = new Ally(x, z, { look: 'ffi', weapon: w, tint: t }); a.hold = true; a.yaw = Math.PI / 2; S.ffi.push(a); }
    // 민간인 4명(안쪽 방에 숨어 있음)
    [[25, -12.5], [28.5, -13.4], [29.6, -7.4], [24.4, -6.8]].forEach(([x, z], k) => S.civ.push(new Civilian(characters, x, z, CIV_TINTS[k], k)));
    for (const [x, z] of [[-8.6, 74], [8.6, 44], [16, 9], [-14, 10], [-26, -48], [26, -60]]) addPickup('med', x, z);
    for (const [x, z] of [[8.6, 88], [-8.6, 50], [12, -14], [-20, 12], [0, -50], [-34, -80]]) addPickup('ammo', x, z);
  },

  allyPlan(a, player, rand) {
    const p = player.pos, sq = p.z < SQUARE.z1 + 4; let tz = Math.max(-90, Math.min(104, p.z + rand(-4, 8))); tz = Math.min(Math.max(tz, a.z - 16), a.z + (a.look ? 30 : 0));
    const t = { x: sq ? Math.max(-40, Math.min(40, p.x + rand(-12, 12))) : Math.max(-8, Math.min(8, p.x + rand(-5, 5))), z: tz }; pushOut(t, .8, heightAt(t.x, t.z), 1.7); return [[t.x, t.z]];
  },

  update(dt, api, ctx) {
    const S = this.state, P = api.player.pos, once = (k, f) => { if (!S.said[k]) { S.said[k] = true; f(); } };
    for (const c of S.civ) c.update(dt, api);
    // 1) 카페에서 레지스탕스와 접선 → 대원 3명 합류
    if (!S.contact && Math.hypot(P.x - CAFE.x, P.z - CAFE.z) < 6) { S.contact = true; for (const a of S.ffi) a.hold = false;
      api.say('레지스탕스: "검문소 너머 동쪽 건물에 민간인들이 갇혀 있소. 서쪽 골목이 우리 바리케이드요!"', 6); }
    // 2) 검문소가 무너지면
    if (S.contact && alive(ctx, (e) => e.zone === 'checkpoint').length === 0) once('cp', () => api.say('검문소 돌파! 동쪽 건물로 들어가라', 4));
    // 3) 점령 건물 진입
    if (!S.entered && inOccupied(P)) { S.entered = true; api.say('건물 안 — 민간인을 다치게 하지 마라', 4); }
    const bClear = S.entered && alive(ctx, (e) => e.zone === 'building').length === 0;
    // 4) 안쪽 방에서 민간인 발견 → 골목이 확보되면 대피
    if (bClear && !S.found && inBox(P, BACK_ROOM)) { S.found = true; api.say('민간인: "살려 주세요! 서쪽 골목에도 독일군이 있어요!"', 5); }
    if (S.found && !S.evac && alive(ctx, (e) => e.zone === 'alley').length === 0) { S.evac = true; for (const c of S.civ) { c.state = 'flee'; c.i = 0; } api.say('레지스탕스: "골목 확보! 사람들을 보내시오!"', 4.5); }
    // 5) 광장 소탕 후 구청 문 앞에서 3초
    const sqLeft = alive(ctx, (e) => e.zone === 'square').length;
    if (this.objectives[3].done({ stage: this, enemies: ctx.enemies, player: api.player }) && sqLeft === 0 && Math.hypot(P.x - HALL_DOOR.x, P.z - HALL_DOOR.z) < 4) S.hold = Math.min(3, S.hold + dt); else S.hold = Math.max(0, S.hold - dt * .5);
    // 해방 장면: 삼색기가 오르고 종이 울린다
    if (S.flagT >= 0) { S.flagT = Math.min(1, S.flagT + dt / 4.5); api.env.raiseFlag(S.flagT); if ((S.bellT -= dt) <= 0) { S.bellT = 1.3; api.sfx('bell', 1); } }
  },
  onWin(api) {
    const S = this.state; S.flagT = 0; S.bellT = 0;
    api.later(.6, () => api.banner('파리 해방', '1944년 8월 25일 — 구청에 삼색기가 오른다', 5));
    // 구청 앞으로 몰려나온 시민들(축하)
    for (let k = 0; k < 6; k++) { const c = new Civilian(api.characters, -9 + k * 3.6, -84 + (k % 2) * 2.5, CIV_TINTS[k % CIV_TINTS.length], k); c.state = 'cheer'; S.civ.push(c); }
    for (const c of S.civ) if (c.state === 'safe') c.state = 'cheer';
    api.later(3.2, () => api.say('본부: "파리는 해방됐다. 그러나 독일군이 국경 방어선을 강화하고 있다."', 6));
  },

  hud(ctx) { const s = ctx.stage.state; return `${alive(ctx, () => true).length}명 · 민간인 ${s.civ.filter((c) => c.state === 'safe' || c.state === 'cheer').length}/4`; },

  objectives: [
    { done: (c) => c.stage.state.contact, progress: (c) => `카페(레지스탕스 접선)까지 ${Math.round(Math.hypot(c.player.pos.x - CAFE.x, c.player.pos.z - CAFE.z))}m`, target: () => CAFE },
    { done: (c) => alive(c, (e) => e.zone === 'checkpoint').length === 0, progress: (c) => `검문소의 적 ${alive(c, (e) => e.zone === 'checkpoint').length}명 — 2층 발코니 저격수 주의`, target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'checkpoint')) },
    { done: (c) => c.stage.state.entered && alive(c, (e) => e.zone === 'building').length === 0,
      progress: (c) => c.stage.state.entered ? `건물 안의 적 ${alive(c, (e) => e.zone === 'building').length}명` : `동쪽 점령 건물 입구까지 ${Math.round(Math.hypot(c.player.pos.x - OCCUPIED.door.x, c.player.pos.z - OCCUPIED.door.z))}m`,
      target: (c) => c.stage.state.entered ? near(c.player.pos, alive(c, (e) => e.zone === 'building')) : OCCUPIED.door },
    { done: (c) => c.stage.state.civ.slice(0, 4).every((v) => v.state === 'safe' || v.state === 'cheer'),
      progress: (c) => { const s = c.stage.state, n = alive(c, (e) => e.zone === 'alley').length; if (!s.found) return '안쪽 방(동쪽 끝)의 민간인을 찾아라'; if (!s.evac) return `서쪽 골목의 적 ${n}명 — 대피로 확보`; return `민간인 대피 중… ${s.civ.filter((v) => v.state === 'safe').length}/4 안전`; },
      target: (c) => { const s = c.stage.state; if (!s.found) return { x: 27, z: -10 }; if (!s.evac) return near(c.player.pos, alive(c, (e) => e.zone === 'alley')) || SAFE; return SAFE; } },
    { done: (c) => c.stage.state.hold >= 3,
      progress: (c) => { const n = alive(c, (e) => e.zone === 'square').length, h = c.stage.state.hold; return n ? `광장의 적 ${n}명` : h > 0 ? `구청 확보 중… ${Math.round(h / 3 * 100)}%` : '구청 정문 앞으로'; },
      target: (c) => { const f = alive(c, (e) => e.zone === 'square'); return f.length ? near(c.player.pos, f) : HALL_DOOR; } },
  ],
};
export { HALL_DOOR };
