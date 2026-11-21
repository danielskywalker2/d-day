// Stage 2 — 생울타리 전투(THE HEDGEROWS) 게임 규칙: 배치, 아군 경로, 저격수, 박격포, 목표.
// game.js 는 스테이지 모듈의 같은 이름 항목(terrain, Env, spawn, allyPlan, objectives, update, hud)만 부른다.
import { TERRAIN2, FARM_H } from './stage2/terrain.js';
import { HedgerowEnvironment } from './stage2/HedgerowEnvironment.js';
import { ROWS, ENEMY_BOX, SCOUT, SNIPER, MG_NEST, MORTAR, CP_ROOM, FARMHOUSE } from './stage2/layout.js';
import { heightAt, pushOut } from '../game/world.js';

const dist2 = (a, x, z) => Math.hypot(a.x - x, a.z - z);
const near = (p, list) => { let best = null, bd = 1e9; for (const t of list) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return best; };
const alive = (c, f) => c.enemies.filter((e) => e.alive && f(e));
const inCP = (p) => p.x > CP_ROOM.minX && p.x < CP_ROOM.maxX && p.z > CP_ROOM.minZ && p.z < CP_ROOM.maxZ;

export default {
  id: 2,
  terrain: TERRAIN2,
  Env: HedgerowEnvironment,
  ambience: 'field',
  playerStart: { x: 0, z: 97, yaw: 0 },
  enemyBox: ENEMY_BOX,
  allyBox: { minX: -70, maxX: 70, minZ: -92, maxZ: 101 },
  playerBox: { minX: -71, maxX: 71, minZ: -93, maxZ: 102 },
  state: { mortarDestroyed: false, mortarT: 9, cpHold: 0, scoutJoined: false, sniper: null, scout: null },

  /** 적·아군·보급 배치. api = { Enemy, Ally, addPickup, V3, env } */
  spawn(api) {
    const { Enemy, Ally, addPickup, V3 } = api, S = this.state, E = (type, x, z, zone, o = {}) => { const e = new Enemy(type, x, z, o.muzzle, o); e.zone = zone; return e; };
    // R2 생울타리 사격 구멍의 소총수(들판 A 를 감시)
    for (const x of [-10, 26, 52]) E('rifle', x, 22.5, 'r2', { holdPos: true });
    // 동쪽 나무 위 저격수
    S.sniper = E('sniper', SNIPER.x, SNIPER.z, 'sniper', { fixedY: heightAt(SNIPER.x, SNIPER.z) + SNIPER.y });
    // R3 방어선: 출입구의 MG42, 사격 구멍의 소총수, 양 측면에서 돌아 들어오는 기관단총수
    E('mg', MG_NEST.x, MG_NEST.z, 'line', { muzzle: new V3(MG_NEST.x, heightAt(MG_NEST.x, MG_NEST.z) + 1.05, MG_NEST.z + 1.8) });
    for (const x of [-50, -34, -4, 10, 52, 62]) E('rifle', x, -13.6, 'line', { holdPos: true });
    E('smg', -62, 2, 'line').flank = true; E('smg', 64, -3, 'line').flank = true;
    // 들판 C: 박격포 사수 2명, 과수원의 소총수
    E('rifle', MORTAR.x - 1.2, MORTAR.z + .4, 'mortar', { holdPos: true }); E('rifle', MORTAR.x + 1, MORTAR.z - .9, 'mortar', { holdPos: true });
    E('rifle', 6, -24, 'orchard'); E('rifle', 20, -38, 'orchard');
    // 농장: 마당·헛간·농가 안(지휘소)
    for (const [x, z] of [[-4, -60], [14, -66], [32, -61]]) E('smg', x, z, 'farm');
    E('rifle', 26, -77, 'farm'); E('rifle', 38, -56.6, 'farm'); E('rifle', -9, -74, 'farm'); E('smg', -18.5, -73, 'farm');
    // 아군 분대(농로에서 출발) + 전방 정찰병(들판 A 의 R2 출입구 앞에 엎드려 대기)
    for (const [x, z] of [[-2, 101], [2, 100.5], [-1.5, 104], [1.6, 103.5], [0, 106]]) new Ally(x, Math.min(z, 101));
    S.scout = new Ally(SCOUT.x, SCOUT.z); S.scout.hold = true; S.scout.yaw = 0;
    // 보급
    for (const [x, z] of [[3, 66], [-46, 30], [20, 0], [-28, -20], [40, -40], [-24, -62]]) addPickup('med', x, z);
    for (const [x, z] of [[-3, 70], [-20, 36], [40, 14], [0, -18], [24, -50], [8, -80]]) addPickup('ammo', x, z);
  },

  /** 아군 돌진 경로: 플레이어 쪽으로, 생울타리를 넘을 때는 가장 가까운 출입구를 거친다 */
  allyPlan(a, player, rand) {
    const p = player.pos; let tz = Math.max(-90, Math.min(100, p.z + rand(-6, 9))); tz = Math.min(Math.max(tz, a.z - 18), a.z);
    const tx = Math.max(-68, Math.min(68, p.x + rand(-12, 12)));
    const path = []; let px = a.x;
    for (const r of ROWS) if (a.z > r.z + 1 && tz < r.z - 1) { const g = r.gaps.reduce((b, x) => (Math.abs(x - px) < Math.abs(b - px) ? x : b)); path.push([g, r.z + 2.6], [g, r.z - 2.6]); px = g; }
    const t = { x: tx, z: tz }; pushOut(t, .7, heightAt(tx, tz), 1.7); path.push([t.x, t.z]); return path;
  },

  /** 매 프레임: 정찰병 합류, 박격포 사격, 지휘소 점령 시간. api = { explode, sfx, say, banner, fx, env, player, V3, rand } */
  update(dt, api, ctx) {
    const S = this.state, P = api.player.pos;
    if (S.scout && S.scout.hold && dist2(S.scout, P.x, P.z) < 4.5) { S.scout.hold = false; S.scoutJoined = true; api.say('정찰병: "동쪽 나무 위에 저격수가 있다. 머리 숙여!"', 4.5); }
    // 박격포: 사수가 살아 있고 플레이어가 들판에 들어오면 7~11초마다 플레이어 근처에 포탄
    const crew = alive(ctx, (e) => e.zone === 'mortar').length;
    if (!S.mortarDestroyed && crew === 0) this.destroyMortar(api, '박격포 사수 전멸 — 박격포 침묵');
    if (!S.mortarDestroyed && crew > 0 && P.z < 58 && P.z > MORTAR.z - 20 && (S.mortarT -= dt) <= 0) {
      S.mortarT = api.rand(7, 11);
      const x = P.x + api.rand(-9, 9), z = P.z + api.rand(-9, 9), pos = new api.V3(x, heightAt(x, z), z);
      api.sfx('whistle', pos); api.later(1.15, () => api.explode(pos, 6, 60, false));
      api.fx.sprite('flash', new api.V3(MORTAR.x, heightAt(MORTAR.x, MORTAR.z) + 1.2, MORTAR.z), { size: .9, life: .08 });
    }
    // 지휘소: 농장의 적을 모두 쓰러뜨린 뒤 방 안에 3초 머물면 점령
    if (inCP(P) && alive(ctx, (e) => e.zone === 'farm' || e.zone === 'orchard').length === 0) S.cpHold = Math.min(3, S.cpHold + dt); else S.cpHold = Math.max(0, S.cpHold - dt * .5);
  },
  /** 폭발이 박격포 가까이(3m)에서 나면 파괴 */
  onExplosion(pos, api) { if (!this.state.mortarDestroyed && Math.hypot(pos.x - MORTAR.x, pos.z - MORTAR.z) < 3.2) this.destroyMortar(api, '박격포 파괴'); },
  destroyMortar(api, msg) { const S = this.state; S.mortarDestroyed = true; api.env.breakMortar(); api.say(msg, 3); },

  hud(ctx) { const n = alive(ctx, () => true).length; return `${n}명`; },

  objectives: [
    { done: (c) => !!c.stage.state.scoutJoined, progress: (c) => `정찰병까지 ${Math.round(dist2(c.player.pos, SCOUT.x, SCOUT.z))}m`, target: () => ({ x: SCOUT.x, z: SCOUT.z }) },
    { done: (c) => !c.stage.state.sniper.alive, progress: () => '동쪽 큰 나무 위 저격 망루 — 엄폐하며 접근', target: () => ({ x: SNIPER.x, z: SNIPER.z }) },
    { done: (c) => alive(c, (e) => e.zone === 'line' || e.zone === 'r2').length === 0 && c.player.pos.z < -10,
      progress: (c) => { const n = alive(c, (e) => e.zone === 'line' || e.zone === 'r2').length; return n ? `방어선의 적 ${n}명 — 출입구는 기관총이 지킨다` : '방어선을 넘어 북쪽으로'; },
      target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'line' || e.zone === 'r2')) || { x: 32, z: -14 } },
    { done: (c) => c.stage.state.mortarDestroyed, progress: (c) => `박격포 사수 ${alive(c, (e) => e.zone === 'mortar').length}명 · 수류탄으로도 파괴 가능`, target: () => ({ x: MORTAR.x, z: MORTAR.z }) },
    { done: (c) => c.stage.state.cpHold >= 3,
      progress: (c) => { const n = alive(c, (e) => e.zone === 'farm' || e.zone === 'orchard').length, h = c.stage.state.cpHold; return n ? `농장의 적 ${n}명` : h > 0 ? `지휘소 확보 중… ${Math.round(h / 3 * 100)}%` : '농가 서쪽 방(지휘소)으로 들어가라'; },
      target: (c) => { const f = alive(c, (e) => e.zone === 'farm' || e.zone === 'orchard'); return f.length ? near(c.player.pos, f) : { x: (CP_ROOM.minX + CP_ROOM.maxX) / 2, z: (CP_ROOM.minZ + CP_ROOM.maxZ) / 2 }; } },
  ],
};

export { FARM_H, FARMHOUSE };
