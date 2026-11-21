// Stage 3 — 코브라 작전(OPERATION COBRA) 게임 규칙: 배치, 셔먼 전차 지원, 대전차포, 교차로 반격, 지휘 거점.
import { TERRAIN3 } from './stage3/terrain.js';
import { RuinedTownEnvironment } from './stage3/RuinedTownEnvironment.js';
import { ENEMY_BOX, PLAYER_BOX, RALLY, MG_NESTS, AT_GUNS, CP_ROOM, CP, CHURCH, COUNTER_SPAWNS, CROSS_Z } from './stage3/layout.js';
import { heightAt, pushOut } from '../game/world.js';

const near = (p, list) => { let best = null, bd = 1e9; for (const t of list) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return best; };
const alive = (c, f) => c.enemies.filter((e) => e.alive && f(e));
const inCP = (p) => p.x > CP_ROOM.minX && p.x < CP_ROOM.maxX && p.z > CP_ROOM.minZ && p.z < CP_ROOM.maxZ;
const TANK_STOP = { x: 2.5, z: 12 };

export default {
  id: 3,
  terrain: TERRAIN3,
  Env: RuinedTownEnvironment,
  ambience: 'field',
  playerStart: { x: -2, z: 100, yaw: 0 },
  enemyBox: ENEMY_BOX, allyBox: PLAYER_BOX, playerBox: PLAYER_BOX,
  state: { joined: false, atDown: [false, false], tank: 'rally', tankZ: RALLY.z, tankT: 4, counter: false, cpHold: 0, atT: [6, 9], rallyAllies: [] },

  spawn(api) {
    const { Enemy, Ally, addPickup, V3 } = api, S = this.state, E = (type, x, z, zone, o = {}) => { const e = new Enemy(type, x, z, o.muzzle, o); e.zone = zone; return e; };
    // 폭격 지대에 남은 독일군(구덩이 속)
    for (const [x, z] of [[-30, 46], [28, 50], [-8, 40], [44, 70]]) E('rifle', x, z, 'field');
    // 마을 외곽: MG42 진지 2곳(모래주머니·2층 창문)과 소총수
    const N = MG_NESTS[0], W = MG_NESTS[1];
    E('mg', N.x, N.z, 'mg', { muzzle: new V3(N.x, heightAt(N.x, N.z) + 1.05, N.z + 1.8) });
    const wy = heightAt(W.x, W.z) + 2.95; E('mg', W.x - 3.4, W.z + .2, 'mg', { fixedY: wy, muzzle: new V3(W.x - 4.35, wy + 1.4, W.z + .2) });
    for (const [x, z] of [[-20, 15], [12, 22], [30, 22], [-38, 26]]) E('rifle', x, z, 'outskirts');
    // 대전차포 사수(포 옆에 붙어 있음)
    AT_GUNS.forEach((A, i) => { E('rifle', A.x - 1, A.z - 1.3, 'at' + i, { holdPos: true }); E('rifle', A.x + 1.1, A.z - 1.1, 'at' + i, { holdPos: true }); });
    // 마을 안(폐허 속)과 성당 종탑의 저격수
    for (const [t, x, z] of [['smg', -12, -6], ['rifle', 13, -34], ['smg', -12, -36], ['rifle', 36, -10], ['smg', -32, -10], ['rifle', 0, -44]]) E(t, x, z, 'village');
    const tz = CHURCH.z + CHURCH.d / 2 + 2.2; E('sniper', CHURCH.x, tz + 1.1, 'village', { fixedY: heightAt(CHURCH.x, tz) + 9.3 });
    // 면사무소(지휘 거점)
    for (const [t, x, z] of [['smg', 18, -54], ['rifle', 26, -52], ['rifle', 24, -60], ['smg', 30, -46]]) E(t, x, z, 'cp');
    // 아군: 플레이어와 함께 출발한 2명 + 집결지의 분대 4명(합류 전까지 대기)
    for (const [x, z] of [[-4, 102], [1, 103]]) new Ally(x, z);
    for (const [x, z] of [[3, 58], [9.5, 58.5], [2, 66], [10, 67]]) { const a = new Ally(x, z); a.hold = true; S.rallyAllies.push(a); }
    for (const [x, z] of [[-4, 80], [-24, 30], [4, 6], [-20, -24], [26, -40]]) addPickup('med', x, z);
    for (const [x, z] of [[2, 88], [20, 40], [-6, 16], [8, -18], [-30, -46]]) addPickup('ammo', x, z);
  },

  allyPlan(a, player, rand) {
    const p = player.pos; let tz = Math.max(-90, Math.min(102, p.z + rand(-5, 9))); tz = Math.min(Math.max(tz, a.z - 18), a.z);
    const t = { x: Math.max(-66, Math.min(66, p.x + rand(-12, 12))), z: tz }; pushOut(t, .8, heightAt(t.x, t.z), 1.7); return [[t.x, t.z]];
  },

  update(dt, api, ctx) {
    const S = this.state, P = api.player.pos, env = api.env;
    if (!S.joined && Math.hypot(P.x - RALLY.x, P.z - RALLY.z) < 8) { S.joined = true; for (const a of S.rallyAllies) a.hold = false; api.say('전차장: "대전차포가 남아 있는 한 전차는 못 나간다. 포를 없애 줘!"', 5); }
    // 대전차포: 사수가 다 쓰러지면 파괴. 살아 있으면 9~13초마다 플레이어 쪽으로 고폭탄
    AT_GUNS.forEach((A, i) => {
      const crew = alive(ctx, (e) => e.zone === 'at' + i).length;
      if (!S.atDown[i] && crew === 0) this.destroyGun(i, api, '대전차포 사수 전멸');
      if (!S.atDown[i] && crew > 0 && P.z < 70 && (S.atT[i] -= dt) <= 0) {
        S.atT[i] = api.rand(9, 13); const from = new api.V3(A.x, heightAt(A.x, A.z) + 1.0, A.z), to = new api.V3(P.x + api.rand(-4, 4), heightAt(P.x, P.z) + 1, P.z + api.rand(-4, 4));
        if (api.losClear(from, to)) { api.fx.sprite('flash', from, { size: 1.4, life: .08 }); api.sfx('boom', from, .45); api.later(.35, () => api.explode(new api.V3(to.x, heightAt(to.x, to.z), to.z), 4.5, 45, false)); }
      }
    });
    // 셔먼: 대전차포 두 문이 없어지면 도로를 따라 전진, 멈춘 뒤 보이는 적에게 6~8초마다 포격
    if (S.tank === 'rally' && S.atDown[0] && S.atDown[1]) { S.tank = 'advance'; api.banner('대전차포 제거', '셔먼 전차가 전진한다', 3.5); }
    if (S.tank === 'advance') { S.tankZ = Math.max(TANK_STOP.z, S.tankZ - dt * 3); const k = (RALLY.z - S.tankZ) / (RALLY.z - TANK_STOP.z), x = RALLY.x + (TANK_STOP.x - RALLY.x) * k; env.moveTank(x, S.tankZ); if (S.tankZ <= TANK_STOP.z) S.tank = 'support'; }
    if (S.tank === 'support' && (S.tankT -= dt) <= 0) {
      S.tankT = api.rand(6, 8); const tp = env.tank.position, from = new api.V3(tp.x, tp.y + 2.3, tp.z - 2);
      const cands = ctx.enemies.filter((e) => e.alive && Math.hypot(e.x - tp.x, e.z - tp.z) < 60 && api.losClear(from, new api.V3(e.x, e.y + 1.2, e.z)));
      const t = cands[Math.random() * cands.length | 0];
      if (t) {
        env.tankTurret.rotation.y = Math.atan2(t.x - tp.x, t.z - tp.z) - env.tank.rotation.y; env.tankTurret.updateMatrixWorld(true);
        api.fx.sprite('flash', new api.V3(tp.x + Math.sin(Math.atan2(t.x - tp.x, t.z - tp.z)) * 3, tp.y + 2.1, tp.z + Math.cos(Math.atan2(t.x - tp.x, t.z - tp.z)) * 3), { size: 2, life: .1 }); api.sfx('boom', from, .5);
        api.later(.25, () => { const p = new api.V3(t.x, heightAt(t.x, t.z), t.z); api.fx.explosion(p, 3.5); api.sfx('boom', p, .7);
          for (const e of ctx.enemies) if (e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 3) api.damageEnemy(e, 999, 'body', new api.V3(e.x - p.x, .5, e.z - p.z).normalize(), 8, null); });
      }
    }
    // 교차로에 들어서면 독일군 반격(6명이 북쪽·동서 골목에서 몰려옴)
    if (!S.counter && Math.hypot(P.x, P.z - CROSS_Z) < 9) { S.counter = true; api.banner('독일군 반격!', '교차로를 지켜라', 4);
      COUNTER_SPAWNS.forEach(([x, z], i) => { const e = new api.Enemy(i % 3 === 2 ? 'rifle' : 'smg', x, z, null, { engage: 140 }); e.zone = 'counter'; e.seen = true; }); }
    if (inCP(P) && alive(ctx, (e) => e.zone === 'cp' || e.zone === 'village' || e.zone === 'counter').length === 0) S.cpHold = Math.min(3, S.cpHold + dt); else S.cpHold = Math.max(0, S.cpHold - dt * .5);
  },
  onExplosion(pos, api) { AT_GUNS.forEach((A, i) => { if (!this.state.atDown[i] && Math.hypot(pos.x - A.x, pos.z - A.z) < 3.2) this.destroyGun(i, api, '대전차포 파괴'); }); },
  destroyGun(i, api, msg) { this.state.atDown[i] = true; api.env.breakGun(i); api.say(msg, 3); },

  hud(ctx) { return `${alive(ctx, () => true).length}명`; },

  objectives: [
    { done: (c) => c.stage.state.joined, progress: (c) => `집결지(셔먼 전차)까지 ${Math.round(Math.hypot(c.player.pos.x - RALLY.x, c.player.pos.z - RALLY.z))}m`, target: () => RALLY },
    { done: (c) => alive(c, (e) => e.zone === 'mg').length === 0, progress: (c) => `남은 기관총 진지 ${alive(c, (e) => e.zone === 'mg').length}/2 — 하나는 2층 창문`, target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'mg')) },
    { done: (c) => c.stage.state.atDown[0] && c.stage.state.atDown[1], progress: (c) => `남은 대전차포 ${c.stage.state.atDown.filter((d) => !d).length}/2 · 사수 사살 또는 수류탄`,
      target: (c) => near(c.player.pos, AT_GUNS.filter((_, i) => !c.stage.state.atDown[i])) },
    { done: (c) => c.stage.state.counter, progress: (c) => `교차로까지 ${Math.round(Math.hypot(c.player.pos.x, c.player.pos.z - CROSS_Z))}m`, target: () => ({ x: 0, z: CROSS_Z }) },
    { done: (c) => c.stage.state.cpHold >= 3,
      progress: (c) => { const n = alive(c, (e) => e.zone === 'cp' || e.zone === 'village' || e.zone === 'counter').length, h = c.stage.state.cpHold; return n ? `마을의 적 ${n}명 (반격 병력 포함)` : h > 0 ? `지휘 거점 확보 중… ${Math.round(h / 3 * 100)}%` : '면사무소 서쪽 방(지휘소)으로'; },
      target: (c) => { const f = alive(c, (e) => e.zone === 'cp' || e.zone === 'village' || e.zone === 'counter'); return f.length ? near(c.player.pos, f) : { x: (CP_ROOM.minX + CP_ROOM.maxX) / 2, z: (CP_ROOM.minZ + CP_ROOM.maxZ) / 2 }; } },
  ],
};
export { CP };
