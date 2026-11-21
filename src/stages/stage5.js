// Stage 5 — 마지막 국경(THE LAST FRONTIER) 게임 규칙: 정찰, 야전 방어선, 지크프리트선 벙커 파괴, 지하 지휘 벙커 침투,
// 마지막 요새 점령과 아군 합류, 그리고 캠페인 1부의 끝(“아직 전쟁은 끝나지 않았다”).
import { TERRAIN5, surface } from './stage5/terrain.js';
import { BorderEnvironment } from './stage5/BorderEnvironment.js';
import { ENEMY_BOX, PLAYER_BOX, OP, BUNKERS, MORTAR, SNIPER_STANDS, HQ, HQ_ROOM, FINAL, LOOK_TARGETS, TRENCH, roadX } from './stage5/layout.js';
import { heightAt, pushOut } from '../game/world.js';

const near = (p, list) => { let best = null, bd = 1e9; for (const t of list) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return best; };
const alive = (c, f) => c.enemies.filter((e) => e.alive && f(e));
const inBox = (p, B) => p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ;
const inHQ = (p) => p.x > HQ.x0 && p.x < HQ.x1 && p.z > HQ.z0 && p.z < HQ.z1;
const wrap = (a) => { while (a > Math.PI) a -= 6.283; while (a < -Math.PI) a += 6.283; return a; };
const RADIO_END = '여기는 본부다. 아직 전쟁은 끝나지 않았다. 우리는 계속 진격한다.';
const COUNTER = [[-40, -84], [48, -72], [30, -100], [-22, -100], [52, -94]];

export default {
  id: 5,
  terrain: TERRAIN5,
  Env: BorderEnvironment,
  ambience: 'field',
  playerStart: { x: 0, z: 106, yaw: 0 },
  enemyBox: ENEMY_BOX, allyBox: PLAYER_BOX, playerBox: PLAYER_BOX,
  winDelay: 3.5, winText: ' — 지크프리트선 돌파',
  state: { seen: [0, 0, 0], recon: false, bunker: [false, false], mortarDown: false, mortarT: 6, hqHold: 0, counter: false, linked: false, reinf: [], squad: [], said: {} },

  spawn(api) {
    const { Enemy, Ally, addPickup, V3 } = api, S = this.state, E = (type, x, z, zone, o = {}) => { const e = new Enemy(type, x, z, o.muzzle, o); e.zone = zone; return e; };
    // 야전 방어선: 참호 속 MG42 2정과 소총수·기관단총
    for (const s of [{ x: -20, z: 28.2 }, { x: 22, z: 32.6 }]) E('mg', s.x, s.z, 'field', { holdPos: true, muzzle: new V3(s.x, surface(s.x, s.z) + .45, s.z + 2.3) });
    for (const [t, x, z, hold] of [['rifle', -44, 30.5, true], ['rifle', -28, 30.5, true], ['smg', 1, 30, false], ['rifle', 15, 30.5, true], ['rifle', 30, 30.5, true], ['smg', 45, 30, false]]) E(t, x, z, 'field', { holdPos: hold });
    // 장거리 저격수: 방어선 뒤 나무 위 저격대
    for (const st of SNIPER_STANDS) E('sniper', st.x, st.z, 'field', { fixedY: surface(st.x, st.z) + st.h + .07 });
    // 지크프리트선 벙커: 총안구 MG42 + 옆의 소총수
    BUNKERS.forEach((B, i) => { const y = surface(B.x, B.z) - .1; E('mg', B.x, B.z + 1.5, 'bunker' + i, { holdPos: true, fixedY: y, muzzle: new V3(B.x, y + 1.4, B.z + B.D / 2 + .35) });
      E('rifle', B.x - 6.5, B.z + 1, 'line', { holdPos: true }); E('rifle', B.x + 6.5, B.z - 1, 'line'); });
    // 박격포 사수
    E('rifle', MORTAR.x - 1.2, MORTAR.z - .8, 'mortar', { holdPos: true }); E('rifle', MORTAR.x + 1.1, MORTAR.z - 1, 'mortar', { holdPos: true });
    // 지하 지휘 벙커: 입구 경비 2명 + 안쪽 6명
    for (const [t, x, z, hold] of [['rifle', 12.5, -18.5, true], ['smg', 1.5, -21, false], ['smg', 5, -44, false], ['rifle', -2, -36, true], ['smg', -3, -48.5, false], ['smg', 12, -34.6, true], ['rifle', 14, -39.5, true], ['rifle', 11, -47.5, true]]) E(t, x, z, 'hq', { holdPos: hold });
    // 마지막 요새: 관측 벙커 MG42 + 둘레 진지
    { const z = FINAL.z + 2, y = surface(FINAL.x, FINAL.z) - .1; E('mg', FINAL.x, z + 2, 'final', { holdPos: true, fixedY: y, muzzle: new V3(FINAL.x, y + 1.45, z + 3.85) }); }
    for (const [t, x, z] of [['rifle', FINAL.x - 8, FINAL.z + 7.6], ['rifle', FINAL.x + 8.5, FINAL.z + 6.4], ['smg', FINAL.x - 14, FINAL.z - 2], ['smg', FINAL.x + 15, FINAL.z - 4]]) E(t, x, z, 'final', { holdPos: t === 'rifle' });
    // 아군: 분대 3명(정찰이 끝날 때까지 숲에서 대기)
    for (const [x, z] of [[-3, 104], [3, 104.5], [0, 108.5]]) { const a = new Ally(x, z); a.hold = true; S.squad.push(a); }
    for (const [x, z] of [[-30, 66], [-6, 52], [10, 22], [-36, 10], [8, -16], [10, -40], [-4, -50], [0, -78]]) addPickup('med', x, z);
    for (const [x, z] of [[2, 96], [-38, 60], [20, 40], [roadX(18), 18], [-20, -6], [14, -45], [2, -60], [20, -82]]) addPickup('ammo', x, z);
  },

  allyPlan(a, player, rand) {
    const p = player.pos; let tz = Math.max(-100, Math.min(106, p.z + rand(-5, 9))); tz = Math.min(Math.max(tz, a.z - 18), a.z + (a.reinf ? 40 : 0));
    const t = { x: Math.max(-66, Math.min(66, p.x + rand(-10, 10))), z: tz }; pushOut(t, .8, heightAt(t.x, t.z), 1.7); return [[t.x, t.z]];
  },

  update(dt, api, ctx) {
    const S = this.state, P = api.player.pos, env = api.env, once = (k, f) => { if (!S.said[k]) { S.said[k] = true; f(); } };
    // 1) 정찰: 정찰 지점에서 벙커 2곳·박격포를 각각 1초씩 바라본다
    if (!S.recon && Math.hypot(P.x - OP.x, P.z - OP.z) < OP.r) {
      once('op', () => api.say('정찰 지점 — 벙커와 박격포 진지를 하나씩 확인하라(조준경을 쓰면 잘 보인다)', 5));
      LOOK_TARGETS.forEach((T, i) => { if (S.seen[i] >= 1) return; const want = Math.atan2(-(T.x - P.x), -(T.z - P.z)); if (Math.abs(wrap(want - api.player.yaw)) < .12) { S.seen[i] += dt; if (S.seen[i] >= 1) api.say(`확인: ${T.name}`, 2.5); } });
      if (S.seen.every((v) => v >= 1)) { S.recon = true; for (const a of S.squad) a.hold = false; api.say('분대장: "좋아, 위치는 다 봤다. 먼저 참호선부터 뚫는다!"', 5); }
    }
    // 박격포: 사수가 살아 있으면 9~12초마다 플레이어 근처에 포탄
    if (!S.mortarDown && alive(ctx, (e) => e.zone === 'mortar').length === 0) this.breakMortar(api, '박격포 사수 전멸');
    if (!S.mortarDown && S.recon && P.z < 75 && P.z > -30 && (S.mortarT -= dt) <= 0) {
      S.mortarT = api.rand(9, 12); const a = api.rand(6.28), r = api.rand(3, 8), x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r, pos = new api.V3(x, heightAt(x, z), z);
      api.sfx('whistle', pos); api.later(1.1, () => api.explode(pos, 5.5, 60, false));
    }
    // 3) 벙커: 총안구 사수가 쓰러지면 무력화
    BUNKERS.forEach((B, i) => { if (!S.bunker[i] && alive(ctx, (e) => e.zone === 'bunker' + i).length === 0) this.destroyBunker(i, api, false); });
    // 4) 지휘실 확보(안의 적을 모두 없애고 지휘실에 2초)
    const hqLeft = alive(ctx, (e) => e.zone === 'hq').length;
    if (inHQ(P)) once('hqIn', () => api.say('지하 벙커 — 좁다. 모퉁이를 조심하라', 4));
    if (hqLeft === 0 && inBox(P, HQ_ROOM)) S.hqHold = Math.min(2, S.hqHold + dt); else if (S.hqHold < 2) S.hqHold = Math.max(0, S.hqHold - dt * .5);
    // 지휘실을 차지하면 독일군 반격(요새 쪽에서 5명)
    if (S.hqHold >= 2 && !S.counter) { S.counter = true; api.say('무전병: "작전 지도 확보! 언덕 위 요새가 마지막이다 — 독일군이 반격해 온다!"', 6); api.banner('독일군 반격', '언덕 위 요새를 점령하라', 4);
      COUNTER.forEach(([x, z], k) => { const e = new api.Enemy(k % 2 ? 'rifle' : 'smg', x, z, null, { engage: 160 }); e.zone = 'final'; e.seen = true; }); }
    // 5) 요새 소탕 + 꼭대기 도착 → 아군 증원이 올라와 합류
    const finLeft = alive(ctx, (e) => e.zone === 'final').length;
    if (S.counter && finLeft === 0 && Math.hypot(P.x - FINAL.x, P.z - FINAL.z) < FINAL.r && !S.reinf.length) {
      api.say('무전: "여기는 증원 분대, 언덕 서쪽으로 올라간다!"', 5);
      for (const [x, z] of [[-26, -66], [-24, -62], [-30, -63], [-28, -69]]) { const a = new api.Ally(x, z); a.reinf = true; S.reinf.push(a); }
    }
    if (S.reinf.length && !S.linked && S.reinf.filter((a) => a.alive && Math.hypot(a.x - P.x, a.z - P.z) < 14).length >= 3) S.linked = true;
  },
  onExplosion(pos, api) {
    BUNKERS.forEach((B, i) => { if (!this.state.bunker[i] && B.slit && pos.distanceTo(B.slit) < 2.8) this.destroyBunker(i, api, true); });
    if (!this.state.mortarDown && Math.hypot(pos.x - MORTAR.x, pos.z - MORTAR.z) < 3) this.breakMortar(api, '박격포 파괴');
  },
  destroyBunker(i, api, blast) {
    const S = this.state; S.bunker[i] = true; api.env.breakBunker(i);
    for (const e of api.enemies) if (e.alive && e.zone === 'bunker' + i) api.damageEnemy(e, 999, 'body', new api.V3(0, .3, -1), 2, null);
    const B = BUNKERS[i]; if (blast) { api.fx.explosion(B.slit.clone(), 3); api.sfx('boom', B.slit, .8); }
    api.say(blast ? `벙커 폭파 (${S.bunker.filter(Boolean).length}/2)` : `벙커 무력화 (${S.bunker.filter(Boolean).length}/2)`, 3);
  },
  breakMortar(api, msg) { this.state.mortarDown = true; api.env.breakMortar(); for (const e of api.enemies) if (e.alive && e.zone === 'mortar') api.damageEnemy(e, 999, 'body', new api.V3(0, .3, -1), 2, null); api.say(msg, 3); },

  onWin(api) {
    api.later(.6, () => { api.player.yaw = 0; api.player.pitch = .02; });   // 독일 본토 쪽을 바라본다 — 이어서 아웃트로(본부 무전, THE WAR IS NOT OVER.)
    api.say('요새 점령 — 증원 분대 합류', 3);
  },
  /** 캠페인 1부의 마지막 화면 */
  endScreen($) {
    $('winTitle').textContent = 'MISSION COMPLETE'; $('winOutro').textContent = `“${RADIO_END}”`;
    $('winNext').innerHTML = 'THE WAR IS NOT OVER.<br>END OF CAMPAIGN – PART ONE';
  },

  hud(ctx) { return `${alive(ctx, () => true).length}명`; },

  objectives: [
    { done: (c) => c.stage.state.recon,
      progress: (c) => { const s = c.stage.state, d = Math.hypot(c.player.pos.x - OP.x, c.player.pos.z - OP.z); if (d > OP.r) return `정찰 지점(숲 가장자리 언덕)까지 ${Math.round(d)}m`; const i = s.seen.findIndex((v) => v < 1); return `정찰 ${s.seen.filter((v) => v >= 1).length}/3 — ${LOOK_TARGETS[i].name}을(를) 바라보라`; },
      target: (c) => { const s = c.stage.state; if (Math.hypot(c.player.pos.x - OP.x, c.player.pos.z - OP.z) > OP.r) return OP; return LOOK_TARGETS[s.seen.findIndex((v) => v < 1)] || OP; } },
    { done: (c) => alive(c, (e) => e.zone === 'field').length === 0, progress: (c) => `야전 방어선의 적 ${alive(c, (e) => e.zone === 'field').length}명 — 나무 위 저격수 주의`, target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'field')) },
    { done: (c) => c.stage.state.bunker.every(Boolean), progress: (c) => `남은 벙커 ${c.stage.state.bunker.filter((b) => !b).length}/2 — 총안구에 수류탄 또는 사수 사살`,
      target: (c) => near(c.player.pos, BUNKERS.filter((_, i) => !c.stage.state.bunker[i]).map((B) => ({ x: B.x, z: B.z + 4 }))) },
    { done: (c) => c.stage.state.hqHold >= 2,
      progress: (c) => { const n = alive(c, (e) => e.zone === 'hq').length, h = c.stage.state.hqHold; return n ? `지휘 벙커의 적 ${n}명 — 경사로로 내려가라` : h > 0 ? `작전 지도 확보 중… ${Math.round(h / 2 * 100)}%` : '지휘실(동쪽 앞방)로'; },
      target: (c) => { const f = alive(c, (e) => e.zone === 'hq'); if (f.length) return inHQ(c.player.pos) || c.player.pos.z < HQ.z1 + 14 ? near(c.player.pos, f) : HQ.door; return { x: 11, z: -37 }; } },
    { done: (c) => c.stage.state.linked,
      progress: (c) => { const s = c.stage.state, n = alive(c, (e) => e.zone === 'final').length; if (n) return `요새의 적 ${n}명 (반격 병력 포함)`; if (!s.reinf.length) return '언덕 꼭대기 요새로'; return `증원 분대 합류 중… ${s.reinf.filter((a) => a.alive && Math.hypot(a.x - c.player.pos.x, a.z - c.player.pos.z) < 14).length}/3`; },
      target: (c) => { const f = alive(c, (e) => e.zone === 'final'); return f.length ? near(c.player.pos, f) : FINAL; } },
  ],
};
