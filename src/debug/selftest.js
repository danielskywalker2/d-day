// 자가 테스트 — http://localhost:8123/?selftest  (GLB 경로까지: ?selftest&models=test)
// 핵심 기능을 실제 게임 루프 위에서 차례로 확인하고 화면 왼쪽 위에 결과를 표시한다.
// 결과는 window.__selftest 에도 남는다. 소리는 켜지 않는다.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 50) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await wait(step); } return !!fn(); }

export async function runSelfTest(G) {
  const results = [], out = (window.__selftest = { done: false, results, passed: 0, failed: 0 });
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99;max-width:520px;max-height:90vh;overflow:auto;background:rgba(0,0,0,.82);color:#e8e4d8;font:12px/1.55 ui-monospace,Menlo,monospace;padding:10px 12px;border:1px solid #e8c97a;pointer-events:none';
  document.body.appendChild(panel);
  const draw = () => { panel.innerHTML = `<b style="color:#e8c97a">D-DAY 자가 테스트</b> ${out.done ? `— 통과 ${out.passed} / 실패 ${out.failed}` : '실행 중…'}<br>` + results.map((r) => `<span style="color:${r.ok ? '#8fd18f' : '#ff7b6b'}">${r.ok ? '✔' : '✘'}</span> ${r.name}${r.detail ? ` <span style="opacity:.65">— ${r.detail}</span>` : ''}`).join('<br>'); };
  const test = async (name, fn) => {
    let ok = false, detail = '';
    try { const r = await fn(); ok = r === true || (r && r.ok); detail = r && r.detail ? r.detail : ''; } catch (e) { detail = '예외: ' + (e.message || e); }
    results.push({ name, ok, detail }); out[ok ? 'passed' : 'failed']++; draw();
  };
  const P = G.player, S = G.state;
  const reset = (x = 0, z = 70, yaw = 0) => { P.pos.set(x, G.heightAt(x, z), z); P.vel.set(0, 0, 0); P.yaw = yaw; P.pitch = 0; P.hp = 100; P.crouch = false; for (const k in G.keys) G.keys[k] = false; };
  // 게임 시간 기준 대기 — 창이 숨겨져 게임이 느리게 돌아도 결과가 같도록 (실제 시간 상한은 6배)
  const gwait = async (ms) => { const t0 = S.time, w0 = performance.now(); while (S.time - t0 < ms / 1000 && performance.now() - w0 < ms * 6 + 500) await wait(16); };
  const aimAt = (x, y, z) => { const dx = x - P.eye.x, dz = z - P.eye.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(y - P.eye.y, Math.hypot(dx, dz)); G.wp.recoil = 0; };
  draw();

  // ---------------------------------------------------------------- 부팅 / 에셋
  await until(() => G.isAssetsReady(), 15000);
  await test('에셋 로딩 완료 후 시작 가능', () => ({ ok: G.isAssetsReady() && G.startGame({ audio: false }), detail: `${G.assets.done}/${G.assets.total}개 처리` }));
  S.god = true; S.grace = 1e9;   // 테스트 중 포격·적 사격으로 죽지 않도록
  if (G.STAGE && G.STAGE.id > 1) { await ({ 2: stage2Suite, 3: stage3Suite, 4: stage4Suite, 5: stage5Suite })[G.STAGE.id](G, { test, reset, gwait, P, S, aimAt }); out.done = true; draw(); console.log(`[selftest] 통과 ${out.passed} / 실패 ${out.failed}`, results); return out; }
  await test('전장 구성 (적 23 · 아군 9 · 보급 15 · 무기 4)', () => ({ ok: G.enemies.length === 23 && G.allies.length === 9 && G.pickups.length === 15 && G.weapons.length === 4, detail: `적 ${G.enemies.length} · 아군 ${G.allies.length} · 보급 ${G.pickups.length}` }));

  // 아군은 플레이어를 따라 전진하므로, 아직 해변에 있을 때 먼저 확인한다
  await test('아군 AI: 해변에서 전진', async () => {
    reset(0, 55, 0); const z0 = G.allies.filter((a) => a.alive).map((a) => a.z); await gwait(5000);
    const moved = G.allies.filter((a, i) => a.alive && i < z0.length && a.z < z0[i] - 3).length; return { ok: moved >= 4, detail: `${moved}명이 3m 이상 전진` };
  });

  // ---------------------------------------------------------------- 이동
  await test('W 키 전진', async () => { reset(); const z0 = P.pos.z; G.keys.KeyW = true; await gwait(600); G.keys.KeyW = false; return { ok: P.pos.z < z0 - 1.2, detail: `${(z0 - P.pos.z).toFixed(2)}m` }; });
  await test('Shift 질주가 걷기보다 빠름', async () => {
    reset(); G.keys.KeyW = true; await gwait(700); const walk = Math.hypot(P.vel.x, P.vel.z);
    G.keys.ShiftLeft = true; await gwait(700); const run = Math.hypot(P.vel.x, P.vel.z); G.keys.KeyW = G.keys.ShiftLeft = false;
    return { ok: run > walk * 1.3, detail: `걷기 ${walk.toFixed(1)} · 질주 ${run.toFixed(1)} m/s` };
  });
  await test('A·D 좌우 이동', async () => { reset(); const x0 = P.pos.x; G.keys.KeyD = true; await gwait(500); G.keys.KeyD = false; const x1 = P.pos.x; G.keys.KeyA = true; await gwait(900); G.keys.KeyA = false; return { ok: x1 > x0 + .8 && P.pos.x < x1 - .8, detail: `${x0.toFixed(1)} → ${x1.toFixed(1)} → ${P.pos.x.toFixed(1)}` }; });
  await test('C 앉기 → 시점 낮아짐', async () => { reset(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC' })); await gwait(400); const low = P.eyeH; P.crouch = false; await gwait(400); return { ok: low < 1.2 && P.eyeH > 1.6, detail: `${low.toFixed(2)}m → ${P.eyeH.toFixed(2)}m` }; });
  await test('Space 점프', async () => { reset(); await gwait(100); G.keys.Space = true; await gwait(120); G.keys.Space = false; const air = P.pos.y - G.heightAt(P.pos.x, P.pos.z); await gwait(900); return { ok: air > .2 && P.onGround, detail: `최고 ${air.toFixed(2)}m 후 착지` }; });
  await test('충돌: 방파제를 통과하지 못함', async () => { reset(-25, 1); P.yaw = 0; G.keys.KeyW = true; await gwait(1500); G.keys.KeyW = false; return { ok: P.pos.z > -2.6, detail: `z=${P.pos.z.toFixed(2)} (벽 앞면 -2.65)` }; });

  // ---------------------------------------------------------------- 조준
  await test('마우스 좌우·상하 회전', async () => {
    reset(); const y0 = P.yaw, p0 = P.pitch;
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 120, movementY: -60, clientX: 640, clientY: 360 }));
    await gwait(50); return { ok: P.yaw < y0 - .1 && P.pitch > p0 + .05, detail: `yaw ${(P.yaw - y0).toFixed(3)} · pitch ${(P.pitch - p0).toFixed(3)}` };
  });
  await test('우클릭 조준(ADS) → 시야각 축소', async () => { reset(); window.dispatchEvent(new MouseEvent('mousedown', { button: 2 })); await gwait(500); const fov = G.renderer.camera.fov, ads = G.wp.ads; window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); await gwait(400); return { ok: ads > .9 && fov < 55, detail: `ads ${ads.toFixed(2)} · fov ${fov.toFixed(1)}` }; });

  // ---------------------------------------------------------------- 무기
  const W = G.weapons;
  await test('사격 → 탄약 1 감소', async () => { reset(); G.switchTo(0); await gwait(450); W[0].ammo = 8; const s0 = S.shots; G.fire(); await gwait(80); return { ok: W[0].ammo === 7 && S.shots === s0 + 1, detail: `탄창 ${W[0].ammo}/8` }; });
  await test('재장전 (R)', async () => { W[0].ammo = 3; const r0 = W[0].reserve; G.startReload(); await gwait(2400); return { ok: W[0].ammo === 8 && W[0].reserve === r0 - 5, detail: `탄창 ${W[0].ammo} · 예비 ${r0} → ${W[0].reserve}` }; });
  await test('빈 탄창 자동 재장전', async () => { W[0].ammo = 1; G.fire(); await gwait(3000); return { ok: W[0].ammo === 8, detail: `탄창 ${W[0].ammo}` }; });
  await test('무기 교체 1→2→3→4 (뷰모델 포함)', async () => {
    const seen = [];
    for (const i of [1, 2, 3, 0]) { G.switchTo(i); await gwait(450); seen.push(G.wp.i === i && G.weaponView.active === i && G.weaponView.views[i].g.visible); }
    return { ok: seen.every(Boolean), detail: seen.map((v) => (v ? '✔' : '✘')).join(' ') };
  });
  await test('톰슨 연사 (누르고 있기)', async () => { G.switchTo(1); await gwait(450); W[1].ammo = 30; G.hold(true); await gwait(500); G.hold(false); return { ok: W[1].ammo <= 26, detail: `0.5초에 ${30 - W[1].ammo}발` }; });
  await test('트렌치건 산탄 10발', async () => { G.switchTo(2); await gwait(450); W[2].ammo = 6; const sh = S.shots; G.fire(); await gwait(60); G.switchTo(0); await gwait(450); return { ok: W[2].ammo === 5 && S.shots === sh + 1, detail: '1회 사격 = 탄 1발 소모' }; });

  // ---------------------------------------------------------------- 2단계: 무기별 동작
  await test('개런드: 마지막 탄 → 클립 배출', async () => { reset(); G.switchTo(0); await gwait(450); W[0].ammo = 1; const d0 = G.weaponView.debris.length; G.fire(); await gwait(200); const clip = G.weaponView.debris.length > d0 + 1; await gwait(2800); return { ok: clip && W[0].ammo === 8, detail: `클립 배출 ${clip ? 'O' : 'X'} → 재장전 후 ${W[0].ammo}발` }; });
  await test('트렌치건: 사격마다 펌프, 펌프 중 재사격 불가', async () => {
    G.switchTo(2); await gwait(450); W[2].ammo = 6; G.fire(); await gwait(80); const pumping = G.wp.action && G.wp.action.name === 'pump'; G.fire(); await gwait(80); const blocked = W[2].ammo === 5;
    await gwait(700); G.fire(); await gwait(80); return { ok: pumping && blocked && W[2].ammo === 4, detail: `펌프 ${pumping ? 'O' : 'X'} · 연타 차단 ${blocked ? 'O' : 'X'} · 남은 ${W[2].ammo}` };
  });
  await test('트렌치건: 한 발씩 장전 (중간에 1발씩 증가)', async () => {
    await gwait(700); W[2].ammo = 2; const r0 = W[2].reserve; G.startReload(); await gwait(1100); const mid = W[2].ammo; await gwait(1800);
    return { ok: mid > 2 && mid < 6 && W[2].ammo === 6 && W[2].reserve === r0 - 4, detail: `장전 중 ${mid}발 → 완료 ${W[2].ammo}발` };
  });
  await test('M1903A4: 볼트 조작 중 재사격 불가 → 끝나면 발사', async () => {
    G.switchTo(3); await gwait(450); W[3].ammo = 5; G.fire(); await gwait(80); const bolt = G.wp.action && G.wp.action.name === 'bolt'; G.fire(); await gwait(80); const blocked = W[3].ammo === 4;
    await gwait(1100); G.fire(); await gwait(80); return { ok: bolt && blocked && W[3].ammo === 3, detail: `볼트 ${bolt ? 'O' : 'X'} · 연타 차단 ${blocked ? 'O' : 'X'} · 남은 ${W[3].ammo}` };
  });
  await test('M1903A4: 한 발씩 장전 + 볼트 닫기', async () => { await gwait(1200); W[3].ammo = 1; G.startReload(); const dur = G.wp.action.dur; await gwait(dur * 1000 + 150); return { ok: W[3].ammo === 5 && !G.wp.action, detail: `4발 장전 ${dur.toFixed(2)}초` }; });
  await test('스코프: 우클릭 켜기 → 원형 시야·레티클·배율, 총기 숨김', async () => {
    reset(); G.switchTo(3); await gwait(450); window.dispatchEvent(new MouseEvent('mousedown', { button: 2 })); window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); await gwait(800);
    const op = +getComputedStyle(document.getElementById('scope')).opacity, fov = G.renderer.camera.fov, hidden = !G.weaponView.root.visible;
    return { ok: G.wp.scoped && op > .9 && fov < 20 && hidden, detail: `오버레이 ${op.toFixed(2)} · 시야각 ${fov.toFixed(1)}° · 총기 숨김 ${hidden ? 'O' : 'X'}` };
  });
  await test('스코프 중 이동 속도 감소', async () => { G.keys.KeyW = true; await gwait(800); const sp = Math.hypot(P.vel.x, P.vel.z); G.keys.KeyW = false; return { ok: sp < 2 && sp > .8, detail: `${sp.toFixed(2)} m/s (평소 4.7)` }; });
  await test('스코프: 다시 우클릭 → 해제', async () => { window.dispatchEvent(new MouseEvent('mousedown', { button: 2 })); window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); await gwait(700); return { ok: !G.wp.scoped && G.scopeK() === 0 && G.weaponView.root.visible, detail: `시야각 ${G.renderer.camera.fov.toFixed(1)}°` }; });
  await test('스코프 사격 → 반동 후 조준점 복귀', async () => {
    G.toggleScope(); await gwait(800); W[3].ammo = 5; const p0 = P.pitch; G.fire(); await gwait(60); const kick = G.wp.recoil; await gwait(1300);
    const back = Math.abs(P.pitch - p0) < 1e-6 && G.wp.recoil < kick * .05; G.toggleScope(); await gwait(500); return { ok: kick > .05 && back, detail: `반동 ${kick.toFixed(3)} → ${G.wp.recoil.toFixed(4)}, 시점 고정` };
  });
  await test('무기별 사거리 피해 차이', () => {
    const f = (i, d) => G.falloff(G.WEAPONS[i], d);
    const ok = f(1, 100) === .5 && f(2, 45) === .35 && f(0, 300) === .8 && f(3, 300) === 1 && G.WEAPONS[3].dmg > 90 && G.WEAPONS[1].bloom > 0;
    return { ok, detail: `100m 톰슨 ×${f(1, 100)} · 45m 산탄 ×${f(2, 45)} · 300m 개런드 ×${f(0, 300)} · 저격 ×${f(3, 300)}` };
  });
  await test('무기 점검 (F)', async () => { await gwait(200); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' })); await gwait(100); const on = G.wp.action && G.wp.action.name === 'inspect'; await gwait(2500); return { ok: on && !G.wp.action, detail: '2.4초 점검 후 복귀' }; });
  await test('HUD: 무기 슬롯 4개 · 현재 무기 강조', () => { const rows = document.querySelectorAll('#slots div'), on = document.querySelector('#slots div.on'); return { ok: rows.length === 4 && on && on.textContent.includes(G.weapons[G.wp.i].def.name), detail: [...rows].map((r) => r.textContent).join(' · ') }; });
  G.switchTo(0); await gwait(450);

  // ---------------------------------------------------------------- 피격 / 데미지
  await test('부위별 배율 (머리 ×2.6 · 다리 ×0.75)', () => {
    const e = G.enemies.find((x) => x.alive && x.type === 'smg'), hp0 = e.hp, d = new G.V3(0, 0, -1);
    G.damageEnemy(e, 10, 'head', d, 0, null); const head = hp0 - e.hp; G.damageEnemy(e, 10, 'leg', d, 0, null); const leg = hp0 - head - e.hp;
    e.hp = hp0; return { ok: Math.abs(head - 26) < 1e-6 && Math.abs(leg - 7.5) < 1e-6, detail: `머리 ${head} · 다리 ${leg}` };
  });
  await test('레이캐스트 명중 → 적 사살·사살 수 증가', async () => {
    const e = G.enemies.find((x) => x.alive && x.type === 'rifle' && x.z < -60), T0 = e.T; e.T = { ...T0, speed: 0 };   // 판정만 보려고 잠시 세워 둔다
    reset(e.x + .5, e.z + 6, 0); await gwait(80); let hit = null; const k0 = S.kills;
    for (let i = 0; i < 4 && e.alive; i++) {
      aimAt(e.x, e.y + 1.2, e.z); await gwait(60); aimAt(e.x, e.y + 1.2, e.z);
      hit = G.castShot(P.eye.clone(), new G.V3().subVectors(new G.V3(e.x, e.y + 1.2, e.z), P.eye).normalize(), 50);
      W[0].ammo = 8; e.hp = 1; G.wp.cool = 0; G.fire(); await gwait(250);
    }
    e.T = T0;
    return { ok: hit && hit.type === 'enemy' && hit.enemy === e && !e.alive && S.kills === k0 + 1, detail: `광선 판정: ${hit && hit.type}/${(hit && hit.part) || '-'}` };
  });
  await test('플레이어 피해·HUD 체력 표시', async () => { reset(); S.god = false; G.damagePlayer(10, P.pos); S.god = true; await gwait(80); return { ok: P.hp === 90 && document.getElementById('hp').textContent === '90', detail: `HP ${P.hp}` }; });
  await test('수류탄 (G) 투척 → 2.6초 뒤 폭발', async () => {
    reset(0, 40, 0); await gwait(80); const n0 = P.grenades; G.throwGrenade(); const thrown = G.grenades.length === 1;
    await gwait(1500); const flying = G.grenades.length === 1; await gwait(1500);
    return { ok: P.grenades === n0 - 1 && thrown && flying && G.grenades.length === 0, detail: `수류탄 ${n0} → ${P.grenades} · 신관 2.6초` };
  });
  await test('폭발 피해 → 반경 안 적만 피해', () => {
    const near = G.enemies.find((x) => x.alive && x.type === 'smg'), far = G.enemies.find((x) => x.alive && x !== near && Math.hypot(x.x - near.x, x.z - near.z) > 20);
    const h1 = near.hp, h2 = far.hp; G.explode(new G.V3(near.x + 1, near.y, near.z), 7.5, 110, true);
    return { ok: (near.hp < h1 || !near.alive) && far.hp === h2, detail: `가까운 적 ${h1} → ${Math.max(0, near.hp).toFixed(0)} · 먼 적 ${h2} → ${far.hp}` };
  });
  await test('보급: 구급상자 +35', async () => {
    const k = G.pickups.find((p) => p.type === 'med'); const n0 = G.pickups.length; reset(k.x, k.z + 3, 0); P.hp = 50; P.pos.set(k.x, G.heightAt(k.x, k.z), k.z); await gwait(150);
    return { ok: P.hp === 85 && G.pickups.length === n0 - 1, detail: `HP 50 → ${P.hp}` };
  });
  await test('보급: 탄약 상자 → 예비탄·수류탄', async () => {
    const k = G.pickups.find((p) => p.type === 'ammo'); const r0 = W[0].reserve; P.grenades = 1; P.pos.set(k.x, G.heightAt(k.x, k.z), k.z); await gwait(150);
    return { ok: W[0].reserve === r0 + 24 && P.grenades === 2, detail: `개런드 예비 +${W[0].reserve - r0} · 수류탄 ${P.grenades}` };
  });

  // ---------------------------------------------------------------- AI
  await test('적 AI: 시야 확보 후 사격', async () => {
    reset(0, -24, 0); S.grace = 0; const s0 = G.fx.tracers.length; let saw = false, fired = false;
    for (let i = 0; i < 40 && !(saw && fired); i++) { await gwait(100); if (G.enemies.some((e) => e.alive && e.los)) saw = true; if (G.fx.tracers.some((t) => t.material === G.fx.tracerMatE)) fired = true; }
    S.grace = 1e9; void s0; return { ok: saw && fired, detail: `시야 ${saw ? 'O' : 'X'} · 예광탄 ${fired ? 'O' : 'X'}` };
  });

  // ---------------------------------------------------------------- 3단계: 병사 모델·애니메이션
  if (G.characters.count.animated > 0) {
    const A = (x) => x.anim;
    await test('병사 모델·애니메이터 (적·아군 전원)', () => { const all = [...G.enemies, ...G.allies.filter((a) => a.alive)]; const n = all.filter(A).length; return { ok: n === all.length && G.characters.count.procedural === 0, detail: `${n}/${all.length}명 · 클립 ${Object.keys(G.enemies[0].anim.actions).length}개` }; });
    await test('애니메이션 전환은 크로스페이드 (순간 전환 없음)', async () => {
      let e = null; for (let i = 0; i < 40 && !e; i++) { e = [...G.enemies, ...G.allies].find((x) => x.alive && x.anim && !x.anim.oneShot && x.anim.base); if (!e) await gwait(50); }   // 단발 동작 중이 아닌 병사
      const an = e.anim, from = an.base; an.setBase(an.baseName === 'Walk' ? 'Idle' : 'Walk', .25); const to = an.base;
      an.mixer.update(.1); const mid = [from.getEffectiveWeight(), to.getEffectiveWeight()]; an.setBase(from.getClip().name, .25);
      // 단발 동작(사격) 중에 이동 상태가 바뀌어도, 사격이 끝나면 새 동작이 다시 보여야 한다
      an.mixer.update(.5); an.fire(); an.mixer.update(.1); an.setBase(an.baseName === 'Walk' ? 'Run' : 'Walk'); const nb = an.base;
      for (let i = 0; i < 40; i++) an.update(.025, { speed: nb.getClip().name === 'Walk' ? 1.3 : 3.3, aiming: false, pitch: 0 });
      const back = nb.isRunning() ? nb.getEffectiveWeight() : 0;
      return { ok: mid[0] > .05 && mid[0] < .95 && mid[1] > .05 && mid[1] < .95 && back > .95, detail: `0.1초 시점 가중치 ${mid.map((w) => w.toFixed(2)).join(' → ')} · 사격 후 이동 동작 복귀 ${back.toFixed(2)}` };
    });
    await test('피격 → Hit 동작', () => { const e = G.enemies.find((x) => x.alive && x.type === 'smg'), hp = e.hp; G.damageEnemy(e, 5, 'head', new G.V3(0, 0, -1), 0, null); const nm = e.anim.oneShot && e.anim.oneShot.getClip().name; e.hp = hp; return { ok: nm === 'HitHead', detail: nm || '없음' }; });
    await test('탄이 떨어지면 Reload 동작·사격 중지', () => { const e = G.enemies.find((x) => x.alive && x.type === 'rifle'); e.rounds = 1; e.tgt = null; e.fire(30); const nm = e.anim.oneShot && e.anim.oneShot.getClip().name; return { ok: nm === 'Reload' && e.cool >= e.T.reload - .01 && e.rounds === e.T.mag, detail: `${nm} · 다음 사격까지 ${e.cool.toFixed(1)}초` }; });
    await test('사망 → Death 동작 후 자세 유지', async () => {
      const e = G.enemies.find((x) => x.alive && x.type === 'smg'); G.damageEnemy(e, 999, 'body', new G.V3(0, 0, -1), 2, null); await gwait(2800);
      const d = e.anim.actions.Death, others = Object.entries(e.anim.actions).filter(([k, a]) => k !== 'Death' && a.isRunning() && a.getEffectiveWeight() > .01);
      return { ok: e.anim.dead && d.time >= d.getClip().duration - .01 && d.getEffectiveWeight() > .99 && !others.length, detail: `Death ${d.time.toFixed(2)}/${d.getClip().duration.toFixed(2)}초 고정` };
    });
    await test('아군: 돌진 중 달리기 · 멈추면 웅크림', async () => {
      const seen = new Set(); for (let i = 0; i < 40 && !(seen.has('Run') && seen.has('CrouchIdle')); i++) { for (const a of G.allies) if (a.alive && a.anim) seen.add(a.anim.baseName); await gwait(100); }
      return { ok: (seen.has('Run') || seen.has('Sprint')) && seen.has('CrouchIdle'), detail: [...seen].join(' · ') };
    });
  }

  // ---------------------------------------------------------------- 그래픽 매니저 / 에셋
  await test('매니저 6종 + Renderer 연결', () => ({ ok: ['renderer', 'assets', 'lighting', 'env', 'fx', 'characters', 'weaponView'].every((k) => G[k]), detail: 'Renderer·Asset·Lighting·Environment·Effects·Character·Weapon' }));
  await test('AssetManager: 캐시·중복 로딩 방지', async () => {
    const url = new URL('./assets/models/_test/crate.glb', location.href).href;
    const a = G.assets.loadModel(url), b = G.assets.loadModel(url); const [ga, gb] = await Promise.all([a, b]);
    if (!ga) return { ok: true, detail: '테스트 모델 없음 — node tools/make-test-models.mjs 실행 후 다시' };
    return { ok: a === b && ga === gb && [...G.assets.models.keys()].filter((k) => k === url).length === 1, detail: '같은 URL → 같은 Promise·같은 결과' };
  });
  await test('AssetManager: 없는 파일 → 예외 없이 null', async () => {
    const t0 = G.assets.total, r = await G.assets.loadModel('./assets/models/_test/__nope__.glb'); await G.assets.whenReady();
    return { ok: r === null && G.assets.models.get('./assets/models/_test/__nope__.glb').status === 'failed' && G.assets.total === t0 + 1 && G.assets.done === G.assets.total && S.mode === 'play', detail: '상태 failed · 진행률 집계 · 게임 계속' };
  });
  await test('AssetManager: 복제본은 독립 변환·공유 지오메트리', async () => {
    const url = new URL('./assets/models/_test/crate.glb', location.href).href; const g = await G.assets.loadModel(url);
    if (!g) return { ok: true, detail: '테스트 모델 없음 — 건너뜀' };
    G.assets.slots.set('__selftest', { key: '__selftest', spec: { url }, url, entry: G.assets.models.get(url) });
    const a = G.assets.instantiate('__selftest', { fit: [2, 2, 2] }), b = G.assets.instantiate('__selftest');
    let ga, gb; a.traverse((o) => { if (o.isMesh && !ga) ga = o.geometry; }); b.traverse((o) => { if (o.isMesh && !gb) gb = o.geometry; });
    const size = G.assets._templates.get('__selftest').userData.size, want = Math.min(2 / size.x, 2 / size.y, 2 / size.z);
    a.position.x = 5; const ok = a !== b && b.position.x === 0 && ga === gb && Math.abs(a.scale.x - want) < 1e-6 && b.scale.x === 1;
    G.assets._templates.delete('__selftest');
    G.assets.slots.delete('__selftest'); return { ok, detail: `fit 배율 ${a.scale.x.toFixed(2)}` };
  });
  const manifest = G.assets.manifest && G.assets.manifest.url || '';
  if (manifest.includes('manifest.test')) {
    const rep = G.assets.report();
    await test('[테스트 매니페스트] 상자 GLB 적용', () => ({ ok: rep.slots['props.crate'] === 'loaded' && G.env.dressed['props.crate'] === 10, detail: `상자 ${G.env.dressed['props.crate'] || 0}개 교체` }));
    await test('[테스트 매니페스트] 텍스처 누락 감지 → 체커', () => {
      const w = rep.warnings.find((x) => x.includes('missing_texture')); let checker = false;
      G.renderer.scene.traverse((o) => { if (o.isMesh && o.material && o.material.map === G.assets.checkerTexture) checker = true; });
      return { ok: !!w && checker && rep.models.some((m) => m.url.includes('missing_texture') && m.missingTextures.length), detail: w || '경고 없음' };
    });
    await test('[테스트 매니페스트] 404 → 절차적 전차 유지', () => ({ ok: rep.slots['props.tank'] === 'failed' && !G.env.dressed['props.tank'], detail: '전차 슬롯 failed, 기본 모델 사용' }));
    await test('[테스트 매니페스트] 깨진 GLB → 기본 톰슨 유지', () => { const v = G.weaponView.views[1]; return { ok: rep.slots['weapons.thompson'] === 'failed' && !v.model, detail: '파싱 실패 → 절차적 총기' }; });
    await test('[테스트 매니페스트] 개런드 GLB + Muzzle 노드', () => { const v = G.weaponView.views[0]; return { ok: !!v.model && Math.abs(v.muzzle.z + .9) < .02, detail: `총구 z=${v.muzzle.z.toFixed(3)}` }; });
    await test('[테스트 매니페스트] 독일군 GLB + 피격 부위 유지', async () => {
      const e = G.enemies.find((x) => x.alive && x.model); if (!e) return { ok: false, detail: '모델이 붙은 적 없음' };
      reset(e.x + .3, e.z + 5, 0); await gwait(60); const tgt = new G.V3(e.x, e.y + 1.6, e.z);
      const hit = G.castShot(P.eye.clone(), new G.V3().subVectors(tgt, P.eye).normalize(), 40);
      return { ok: hit.type === 'enemy' && hit.part === 'head' && G.characters.count.model === 23, detail: `헤드 판정 ${hit.part} · 모델 적용 ${G.characters.count.model}명` };
    });
  }

  // ---------------------------------------------------------------- 5단계: 렌더링·조명
  await test('5단계: F8 로 기존 ↔ 개선 그래픽 전환', async () => {
    const R = G.renderer, L = G.lighting, f8 = () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'F8' })); };
    const q0 = R.quality; f8(); await gwait(100); const q1 = R.quality, fireOff = L.fires.every((l) => !l.visible), fog1 = R.scene.fog.density; f8(); await gwait(100);
    return { ok: q0 === 'high' && q1 === 'legacy' && fireOff && R.quality === 'high' && L.fires.every((l) => l.visible) && fog1 > R.scene.fog.density, detail: `${q0} → ${q1} → ${R.quality} · 화염광 ${L.fires.length}개` };
  });
  await test('5단계: 차폐(SSAO)·원거리 대기 버퍼', async () => {
    // 해변에서 절벽(약 95m)을 본다 — 앞선 테스트의 조준·스코프 상태와 무관하게 카메라를 직접 둔다
    const R = G.renderer, cam = R.camera, fov = cam.fov;
    cam.position.set(0, G.heightAt(0, 60) + 1.7, 60); cam.rotation.set(-.05, 0, 0); cam.fov = 75; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    R.render(1, { viewModel: true }); cam.fov = fov; cam.updateProjectionMatrix();
    const t = R.rtAO, buf = new Uint8Array(t.width * t.height * 4); R.gl.readRenderTargetPixels(t, 0, 0, t.width, t.height, buf);
    let dark = 0, haze = 0; for (let i = 0; i < buf.length; i += 4) { if (buf[i] < 220) dark++; if (buf[i + 1] > 20) haze++; }
    const n = t.width * t.height;
    return { ok: dark > n * .0005 && haze > n * .02, detail: `차폐 화소 ${(dark / n * 100).toFixed(1)}% · 대기 화소 ${(haze / n * 100).toFixed(1)}%` };
  });
  await test('5단계: 구름 그림자가 표준 재질에 적용', () => { let n = 0, std = 0; G.renderer.scene.traverse((o) => { const m = o.material; if (m && m.isMeshStandardMaterial) { std++; if (m.userData.cloud) n++; } }); return { ok: std > 0 && n / std > .95, detail: `${n}/${std}` }; });

  // ---------------------------------------------------------------- 6단계: 전투 효과·사운드
  await test('6단계: 실제 총성 샘플 16개 수신', async () => { const n = await G.audio.fetched(); return { ok: n === G.audio.total && n === 16, detail: `${n}/${G.audio.total}` }; });
  await test('6단계: 맞은 물체의 재질 구분 (방파제·고슴도치·상자)', async () => {
    const shot = (x, z, tx, ty, tz) => { const o = new G.V3(x, G.heightAt(x, z) + 1.4, z), t = new G.V3(tx, ty, tz); return G.castShot(o, t.sub(o).normalize(), 60); };
    const wall = shot(-25, 6, -25, G.heightAt(-25, -1) + 1, -1);
    let metal = null, wood = null;
    for (const o of G.env.scene.children) { if (o.visible || !o.isMesh) continue; const k = G.surfaceOf(o); if (k === 'metal' && !metal) metal = o; if (k === 'wood' && !wood) wood = o; }
    const kinds = [wall.type === 'solid' ? G.surfaceOf(wall.object) : wall.type, metal ? 'metal' : '-', wood ? 'wood' : '-'];
    return { ok: kinds[0] === 'concrete' && !!metal && !!wood, detail: kinds.join(' · ') };
  });
  await test('6단계: 효과 누적 상한 (탄착 400회)', async () => {
    const fx = G.fx, p = new G.V3(0, G.heightAt(0, 30), 30);
    for (let i = 0; i < 400; i++) fx.impact(['concrete', 'metal', 'sand', 'wood'][i % 4], p, null, null, 1);
    for (let i = 0; i < 3; i++) fx.explosion(p, 6);
    return { ok: fx.debris.length <= 700 && fx.sprites.length <= 262 && fx.counts.dropped > 0, detail: `파편 ${fx.debris.length}/700 · 연기 ${fx.sprites.length}/260 · 버림 ${fx.counts.dropped}` };
  });
  await test('6단계: 동시 발음 상한 (탄착음 30회 → 8개)', async () => {
    const A = G.audio; A.init(); const p = new G.V3(P.pos.x + 3, 0, P.pos.z);
    for (let i = 0; i < 30; i++) A.sfx('impact', 'metal', p);
    const n = A.voices.impact.length; return { ok: n <= 8 && A.stats.dropped >= 22, detail: `동시 ${n} · 버림 ${A.stats.dropped}` };
  });
  await test('6단계: MG42 분당 1,200발', async () => {
    const mg = G.enemies.find((e) => e.alive && e.type === 'mg'); if (!mg) return { ok: false, detail: 'MG 없음' };
    mg.burst = 3; mg.burstGap = 0; mg.rounds = 50; const r0 = mg.rounds; mg.update(.001); const gap = mg.burstGap; mg.burst = 0; mg.cool = 2;
    return { ok: Math.abs(gap - .05) < .002 && mg.rounds === r0 - 1, detail: `발사 간격 ${gap.toFixed(3)}초` };
  });

  // ---------------------------------------------------------------- 7단계: 그래픽 확인·성능
  const isTestManifest = (G.assets.manifest && G.assets.manifest.url || '').includes('manifest.test');
  const placeCam = (x, z, tx, tz, pitch = -.05) => { const cam = G.renderer.camera; cam.position.set(x, G.heightAt(x, z) + 1.7, z); cam.rotation.set(pitch, Math.atan2(-(tx - x), -(tz - z)), 0); cam.fov = 75; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); G.env.update(1, cam.position); for (const e of [...G.enemies, ...G.allies]) G.characters.lod(e, cam.position); return cam; };
  if (!isTestManifest) await test('7단계: 텍스처 누락 0 · 모델 슬롯 실패 0', () => { const rep = G.assets.report(), failed = Object.entries(rep.slots).filter(([, v]) => v === 'failed').map(([k]) => k);
    return { ok: G.assets.failedTextures.length === 0 && failed.length === 0, detail: `텍스처 실패 ${G.assets.failedTextures.length} · 슬롯 실패 ${failed.join(',') || 0} · 경고 ${rep.warnings.length}` }; });
  if (!isTestManifest) await test('7단계: 총기 모델 4종 (GLB 3 + 코드 1)', () => { const v = G.weaponView.views, glb = v.filter((x) => x.model).length, ok = !!v[0].model && !!v[1].model && !!v[3].model && v[2].g.children.length > 0;
    return { ok, detail: `GLB ${glb}개 (개런드·톰슨·스프링필드) · 트렌치건 코드 모델` }; });
  if (!isTestManifest) await test('7단계: 병사 모델 전원 + 화면 밖 컬링', () => {
    const all = [...G.enemies, ...G.allies].filter((s) => s.model); let culled = 0, sk = 0;
    for (const s of all) s.model.traverse((o) => { if (o.isSkinnedMesh) { sk++; if (o.frustumCulled && o.boundingSphere) culled++; } });
    return { ok: all.length === G.enemies.length + G.allies.length && culled === sk, detail: `모델 ${all.length}명 · 컬링 가능 메시 ${culled}/${sk}` };
  });
  if (!isTestManifest) await test('7단계: 조명·그림자 (태양 그림자 + 주요 물체)', () => {
    const L = G.lighting, sun = L.sun; let tank = false, bunker = false, hog = false, soldier = false;
    G.renderer.scene.traverse((o) => { if (!o.isMesh || !o.castShadow || !o.visible) return; const m = o.material; if (m === G.env.PM.tank) tank = true; if (m === G.env.PM.concrete) bunker = true; if (o.isInstancedMesh && m === G.env.PM.rust) hog = true; if (o.isSkinnedMesh) soldier = true; });
    return { ok: G.renderer.gl.shadowMap.enabled && sun.castShadow && tank && bunker && hog && soldier, detail: `그림자 지도 ${sun.shadow.mapSize.x}px · 전차 ${tank ? 'O' : 'X'} 벙커 ${bunker ? 'O' : 'X'} 고슴도치 ${hog ? 'O' : 'X'} 병사 ${soldier ? 'O' : 'X'}` };
  });
  await test('7단계: 원거리 렌더링 (절벽 벙커가 시야 안 · 안개)', () => { const cam = G.renderer.camera, d = Math.hypot(0 - 0, -39 - 70);
    return { ok: cam.far > d + 50 && G.renderer.scene.fog && G.renderer.scene.fog.density < .01, detail: `시야 ${cam.far}m · 해변 시작→벙커 ${d.toFixed(0)}m · 안개 ${G.renderer.scene.fog.density}` }; });
  await test('7단계: Draw Call — 해변 시작 시점 900 미만 (효과가 쌓인 상태)', () => {
    // 앞선 테스트가 남긴 파편·탄흔·연기(수백 개)가 화면에 있는 상태 그대로 잰다 — 전투 중 최악에 가까운 조건
    const R = G.renderer, gl = R.gl; placeCam(4, 66, 4, 20); gl.info.autoReset = false; gl.info.reset(); R.render(1, { viewModel: true }); const c = gl.info.render.calls, t = gl.info.render.triangles; gl.info.autoReset = true;
    return { ok: c < 900, detail: `${c}회 · ${(t / 1e6).toFixed(2)}M 삼각형 · 파편 ${G.fx.debris.length} · 탄흔 ${G.fx.decals.length} (최적화 전 평상시 약 1,600회 · 3.0M)` };
  });
  if (!isTestManifest) await test('7단계: 거리별 LOD (모래주머니·소품)', () => {
    const bags = G.env.lods.find((l) => l.levels[0].far); placeCam(4, 66, 4, 20); bags.update(G.renderer.camera.position, true); const far = { ...bags.stats };
    placeCam(-8, -31, -20, -36); bags.update(G.renderer.camera.position, true); const near = { ...bags.stats };
    const draws = G.env.lods.reduce((n, l) => n + l.drawCount, 0), items = G.env.lods.reduce((n, l) => n + l.items.length, 0);
    return { ok: far.near === 0 && far.far > 0 && near.near > 0, detail: `해변: 정밀 ${far.near}/단순 ${far.far} · 절벽: 정밀 ${near.near}/단순 ${near.far} · 소품 ${items}개를 ${draws}회로` };
  });
  if (!isTestManifest) await test('7단계: 병사 LOD (먼 병사 골격 계산 생략·눈 숨김)', () => { placeCam(4, 66, 4, 20); const all = [...G.enemies, ...G.allies].filter((s) => s.anim && !s.anim.dead), skip = all.filter((s) => s.anim.skip > 0).length, hidden = all.filter((s) => s._faceVis === false).length;
    return { ok: skip > 0 && hidden > 0, detail: `골격 계산 생략 ${skip}/${all.length}명 · 눈 숨김 ${hidden}명` }; });
  await test('7단계: 오브젝트 풀링 (파편·연기 재사용, 장면 객체 수 고정)', async () => {
    const fx = G.fx, sc = G.renderer.scene, p = new G.V3(0, G.heightAt(0, 30), 30), round = () => { for (let i = 0; i < 40; i++) fx.impact('concrete', p, null, null, 1); for (let i = 0; i < 120; i++) fx.update(1 / 30, G.heightAt); };
    // 풀은 처음 몇 번 최대 사용량까지 자란 뒤 더 늘지 않아야 한다(파편은 장면 객체가 아니라 인스턴스로 그림)
    round(); round(); round(); const n1 = sc.children.length, f1 = Object.values(fx.debrisFree).reduce((n, l) => n + l.length, 0); for (let k = 0; k < 4; k++) round(); const n2 = sc.children.length;
    return { ok: n2 === n1 && f1 > 0 && Object.keys(fx.debrisIM).length <= 16, detail: `장면 객체 ${n1} → ${n2} (4번 더 반복) · 대기 중 파편 ${f1} · 파편 그리기 ${Object.keys(fx.debrisIM).length}종` };
  });
  await test('7단계: 폭발 효과 (섬광·충격파·연기·폭발광)', () => {
    const fx = G.fx, s0 = fx.sprites.length, p = new G.V3(10, G.heightAt(10, 30), 30); G.explode(p, 6, 0, false);
    const ring = (fx.rings || []).some((r) => r.visible), light = G.lighting.fx.some((l) => l.userData.t > 0);
    return { ok: ring && light && fx.sprites.length > s0 + 10, detail: `스프라이트 +${fx.sprites.length - s0} · 충격파 ${ring ? 'O' : 'X'} · 폭발광 ${light ? 'O' : 'X'}` };
  });

  // ---------------------------------------------------------------- 캠페인 (2단계: 캠페인 관리자·목표)
  await test('캠페인: 저장·해금 (메모리 저장소로 시험)', () => {
    const mem = new Map(), store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
    const C = new G.campaign.constructor(store); const a = C.isUnlocked(1) && !C.isUnlocked(2); const r = C.complete(1, { kills: 3 });
    const C2 = new G.campaign.constructor(store);   // 다시 불러와도 유지되는지
    return { ok: a && r.unlockedNext === 2 && C2.isUnlocked(2) && C2.isCompleted(1) && !C2.isUnlocked(3) && C2.current === 2, detail: `1 완료 → 2 해금, 다시 불러와도 유지 · 이어서 할 스테이지 ${C2.current}` };
  });
  await test('캠페인: Stage 1 목표 5단계 표시', () => { const L = G.objectives.list({ player: P, enemies: G.enemies, allies: G.allies }); return { ok: L.length === 5 && L.every((o) => o.text), detail: L.map((o) => o.state[0]).join('') + ' · ' + (G.objectives.current ? G.objectives.current.text : '완료') }; });

  // ---------------------------------------------------------------- 승패 (마지막)
  await test('사망 처리 → 전사 화면', async () => {
    S.god = false; G.damagePlayer(999, P.pos); const dead = P.dead;
    const shown = await until(() => S.mode === 'dead' && getComputedStyle(document.getElementById('dead')).display === 'flex', 12000);
    // 다음 테스트를 위해 되살린다
    P.dead = false; P.hp = 100; P.eyeH = 1.7; S.mode = 'play'; document.getElementById('dead').style.display = 'none'; S.god = true; G.renderer.camera.rotation.z = 0;
    return { ok: dead && shown, detail: '체력 0 → 1.6초 뒤 전사 화면' };
  });
  await test('승리 처리 → 교두보 확보 화면', async () => {
    reset(0, -39); await gwait(100);   // 캠페인 목표 3(벙커 내부 침투)을 거쳐야 마지막 목표가 열린다
    for (const e of G.enemies) if (e.alive) G.damageEnemy(e, 9999, 'body', new G.V3(0, 0, -1), 1, null);
    const shown = await until(() => S.mode === 'win' && getComputedStyle(document.getElementById('win')).display === 'flex', 15000);
    return { ok: shown && S.won, detail: document.getElementById('winStats').textContent.replace(/\s+/g, ' ').trim() };
  });

  out.done = true; out.report = G.assets.report(); draw();
  console.log(`[selftest] 통과 ${out.passed} / 실패 ${out.failed}`, results);
  return out;
}

// ---------------------------------------------------------------- Stage 2 (생울타리) 전용 — http://localhost:8123/?stage=2&selftest&unlockall
async function stage2Suite(G, { test, reset, gwait, P, S }) {
  const W = G.weapons, kill = (f) => { for (const e of G.enemies) if (e.alive && f(e)) G.damageEnemy(e, 9999, 'body', new G.V3(0, 0, -1), 1, null); };
  const losOf = (f) => G.enemies.filter((e) => e.alive && f(e)).filter((e) => e.los).length;
  await test('S2 전장 구성 (적 24 · 아군 6 · 무기 4 · 지형 교체)', () => ({ ok: G.enemies.length === 24 && G.allies.length === 6 && W.length === 4 && G.heightAt(0, 96) > 1, detail: `적 ${G.enemies.length} · 아군 ${G.allies.length} · 출발점 높이 ${G.heightAt(0, 96).toFixed(2)}m (해변 지형이 아님)` }));
  await test('S2 이동·사격·재장전', async () => { reset(0, 96); const z0 = P.pos.z; G.keys.KeyW = true; await gwait(600); G.keys.KeyW = false; const moved = z0 - P.pos.z; G.switchTo(0); await gwait(450); W[0].ammo = 8; G.fire(); await gwait(80); const a = W[0].ammo; W[0].ammo = 3; G.startReload(); await gwait(2400);
    return { ok: moved > 1.2 && a === 7 && W[0].ammo === 8, detail: `전진 ${moved.toFixed(1)}m · 사격 후 ${a} · 재장전 후 ${W[0].ammo}` }; });
  await test('S2 생울타리가 이동을 막음 (출입구 밖)', async () => { reset(0, 30, 0); G.keys.KeyW = true; await gwait(1800); G.keys.KeyW = false; return { ok: P.pos.z > 24.9, detail: `z=${P.pos.z.toFixed(2)} (생울타리 중심 24, 남쪽 면 25.1)` }; });
  await test('S2 출입구로는 지나감', async () => { reset(12, 30, 0); G.keys.KeyW = true; await gwait(1800); G.keys.KeyW = false; return { ok: P.pos.z < 22, detail: `x=12 출입구 → z=${P.pos.z.toFixed(1)}` }; });
  await test('S2 생울타리가 시야를 막고 사격 구멍으로는 보임', async () => { reset(0, 96); await gwait(900); const lane = losOf(() => true); reset(-6, 48); await gwait(900); const fieldA = losOf((e) => e.zone === 'r2');
    return { ok: lane === 0 && fieldA > 0, detail: `농로에서 나를 보는 적 ${lane}명 · 들판 A 에서 R2 사격 구멍 ${fieldA}명` }; });
  await test('S2 저격수: 나무 위 망루에서 들판 A 를 감시', async () => { const sn = G.enemies.find((e) => e.type === 'sniper'); reset(-20, 40); await gwait(1200);
    return { ok: sn.y - G.heightAt(sn.x, sn.z) > 5 && sn.los, detail: `발판 높이 ${(sn.y - G.heightAt(sn.x, sn.z)).toFixed(1)}m · 시야 ${sn.los ? 'O' : 'X'}` }; });
  await test('S2 정찰병: 합류 전 대기 → 접근하면 합류', async () => { const sc = G.STAGE_MODULE.state.scout, held = sc.hold; reset(-40, 31.5); await gwait(600); return { ok: held && !sc.hold && G.objectives.index >= 1, detail: `대기 ${held ? 'O' : 'X'} → 합류 ${!sc.hold ? 'O' : 'X'} · 목표 ${G.objectives.index + 1}` }; });
  await test('S2 아군 경로가 생울타리 출입구를 거침 (한 번에 최대 18m 돌진)', () => { const mid = (x, y) => (x + y) / 2, plan = (a, pz) => G.STAGE_MODULE.allyPlan(a, { pos: new G.V3(0, 0, pz) }, mid), fmt = (p) => p.map(([x, z]) => `(${x.toFixed(0)},${z.toFixed(0)})`).join('→');
    const p1 = plan({ x: 3, z: 70 }, 0), p2 = plan({ x: 5, z: 30 }, 0), viaR1 = p1.some(([x, z]) => Math.abs(x) < 1 && z > 60), viaR2 = p2.some(([x, z]) => x === 12 && z > 24 && z < 27);
    return { ok: viaR1 && viaR2, detail: `R1: ${fmt(p1)} · R2: ${fmt(p2)}` }; });
  await test('S2 박격포: 들판에 들어오면 포탄이 날아옴', async () => { const M = G.STAGE_MODULE.state; reset(0, 10); const sc0 = G.fx.decals.filter((d) => d.userData.kind === 'scorch').length; M.mortarT = 0; await gwait(1800);
    const sc1 = G.fx.decals.filter((d) => d.userData.kind === 'scorch').length; return { ok: sc1 > sc0, detail: `포탄 자국 ${sc0} → ${sc1}` }; });
  await test('S2 목표 5단계 진행 → 작전 성공 · 기록 저장', async () => {
    const log = []; kill((e) => e.type === 'sniper'); await gwait(300); log.push(G.objectives.index);
    kill((e) => e.zone === 'line' || e.zone === 'r2'); reset(32, -14); await gwait(400); log.push(G.objectives.index);
    G.explode(new G.V3(34, G.heightAt(34, -30), -30.5), 6, 0, true); await gwait(300); log.push(G.objectives.index);
    kill((e) => e.zone === 'farm' || e.zone === 'orchard'); reset(-18, -72); await gwait(3600); log.push(G.objectives.finished ? 'done' : G.objectives.index);
    const t0 = performance.now(); while (S.mode !== 'win' && performance.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
    return { ok: S.mode === 'win' && G.campaign.isCompleted(2) && G.campaign.isUnlocked(3), detail: `목표 진행 ${log.join('→')} · 화면 ${S.mode} · Stage 3 해금 ${G.campaign.isUnlocked(3) ? 'O' : 'X'}` };
  });
}

// ---------------------------------------------------------------- Stage 3 (코브라 작전) 전용 — ?stage=3&selftest
async function stage3Suite(G, { test, reset, gwait, P, S }) {
  const W = G.weapons, M = G.STAGE_MODULE, kill = (f) => { for (const e of G.enemies) if (e.alive && f(e)) G.damageEnemy(e, 9999, 'body', new G.V3(0, 0, -1), 1, null); };
  await test('S3 전장 구성 (적 25 · 아군 6 · 지형 교체)', () => ({ ok: G.enemies.length === 25 && G.allies.length === 6 && Math.abs(G.heightAt(0, -20) - 1.2) < .5, detail: `적 ${G.enemies.length} · 아군 ${G.allies.length} · 교차로 높이 ${G.heightAt(0, -20).toFixed(2)}` }));
  await test('S3 이동·사격·재장전', async () => { reset(-2, 100); const z0 = P.pos.z; G.keys.KeyW = true; await gwait(600); G.keys.KeyW = false; const moved = z0 - P.pos.z; G.switchTo(0); await gwait(450); W[0].ammo = 8; G.fire(); await gwait(80); const a = W[0].ammo; W[0].ammo = 3; G.startReload(); await gwait(2400);
    return { ok: moved > 1.2 && a === 7 && W[0].ammo === 8, detail: `전진 ${moved.toFixed(1)}m · 사격 후 ${a} · 재장전 후 ${W[0].ammo}` }; });
  await test('S3 무너진 집 벽이 막고 문으로는 들어감', async () => { reset(-6, -6, Math.PI / 2); G.keys.KeyW = true; await gwait(1500); G.keys.KeyW = false; const inside = P.pos.x < -9.4;   // 동쪽 문(x=-9, z=-6)으로 들어감
    reset(-6, -2.4, Math.PI / 2); G.keys.KeyW = true; await gwait(1500); G.keys.KeyW = false; const blocked = P.pos.x > -9.2;
    return { ok: inside && blocked, detail: `문으로 ${inside ? '들어감' : '못 들어감'} · 벽 앞 ${blocked ? '막힘' : '통과(오류)'}` }; });
  await test('S3 2층 창문의 MG42 가 바깥을 봄', async () => { const mg = G.enemies.find((e) => e.type === 'mg' && e.fixedY); reset(4, 22); await gwait(1200); return { ok: mg.y - G.heightAt(mg.x, mg.z) > 2.5 && mg.los, detail: `높이 ${(mg.y - G.heightAt(mg.x, mg.z)).toFixed(1)}m · 시야 ${mg.los ? 'O' : 'X'}` }; });
  await test('S3 목표 1: 집결지 합류 → 대기 분대 출발', async () => { const held = M.state.rallyAllies.every((a) => a.hold); reset(6, 58); await gwait(500); return { ok: held && M.state.joined && M.state.rallyAllies.every((a) => !a.hold) && G.objectives.index >= 1, detail: `대기 ${held ? 'O' : 'X'} → 합류 ${M.state.joined ? 'O' : 'X'}` }; });
  await test('S3 대전차포: 수류탄 1문 · 사수 사살 1문 → 셔먼 전진', async () => {
    kill((e) => e.zone === 'mg'); await gwait(300);
    G.explode(new G.V3(-6.5, G.heightAt(-6.5, 4), 4.3), 6, 0, true); await gwait(200); const a = M.state.atDown[0];
    kill((e) => e.zone === 'at1'); await gwait(300); const b = M.state.atDown[1], z0 = G.env.tank.position.z; await gwait(3000);
    return { ok: a && b && M.state.tank !== 'rally' && G.env.tank.position.z < z0 - 3 && G.objectives.index >= 3, detail: `포1 ${a ? '파괴' : 'X'} · 포2 ${b ? '파괴' : 'X'} · 전차 z ${z0.toFixed(1)} → ${G.env.tank.position.z.toFixed(1)}` };
  });
  await test('S3 셔먼 지원 사격이 적을 쓰러뜨림', async () => {
    M.state.tankZ = 12; M.state.tank = 'support'; G.env.moveTank(2.5, 12); M.state.tankT = 0;
    const t0 = G.enemies.filter((e) => e.alive).length; await gwait(3500); const t1 = G.enemies.filter((e) => e.alive).length;
    return { ok: t1 < t0, detail: `살아 있는 적 ${t0} → ${t1}` };
  });
  await test('S3 교차로 도착 → 독일군 반격 6명', async () => { const n0 = G.enemies.length; reset(0, -18); await gwait(500); return { ok: M.state.counter && G.enemies.length === n0 + 6 && G.enemies.filter((e) => e.zone === 'counter').every((e) => e.seen), detail: `적 ${n0} → ${G.enemies.length}` }; });
  await test('S3 반격 병력이 교차로로 몰려옴', async () => { const c = G.enemies.filter((e) => e.zone === 'counter' && e.alive), d0 = c.reduce((s, e) => s + Math.hypot(e.x, e.z + 20), 0) / c.length; await gwait(4000); const d1 = c.reduce((s, e) => s + Math.hypot(e.x, e.z + 20), 0) / c.length; return { ok: d1 < d0 - 4, detail: `교차로까지 평균 ${d0.toFixed(0)}m → ${d1.toFixed(0)}m` }; });
  await test('S3 목표 5: 마을 소탕 + 지휘소 3초 → 작전 성공 · 기록', async () => {
    kill(() => true); reset(18.5, -54); await gwait(3600);
    const t0 = performance.now(); while (S.mode !== 'win' && performance.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
    return { ok: S.mode === 'win' && G.campaign.isCompleted(3), detail: `화면 ${S.mode} · Stage 3 완료 저장 ${G.campaign.isCompleted(3) ? 'O' : 'X'}` };
  });
}

async function stage4Suite(G, { test, reset, gwait, P, S, aimAt }) {
  const W = G.weapons, M = G.STAGE_MODULE, st = M.state, kill = (f) => { for (const e of G.enemies) if (e.alive && f(e)) G.damageEnemy(e, 9999, 'body', new G.V3(0, 0, -1), 1, null); };
  const civ = st.civ;
  await test('S4 전장 구성 (적 24 · 아군 5 · 민간인 4 · 지형 교체)', () => ({ ok: G.enemies.length === 24 && G.allies.length === 5 && civ.length === 4 && Math.abs(G.heightAt(0, 20) - 1) < .01 && Math.abs(G.heightAt(8.5, 20) - 1.15) < .01,
    detail: `적 ${G.enemies.length} · 아군 ${G.allies.length} · 민간인 ${civ.length} · 차도 ${G.heightAt(0, 20).toFixed(2)} / 인도 ${G.heightAt(8.5, 20).toFixed(2)}` }));
  await test('S4 이동·사격·재장전', async () => { reset(0, 100); const z0 = P.pos.z; G.keys.KeyW = true; await gwait(600); G.keys.KeyW = false; const moved = z0 - P.pos.z; G.switchTo(0); await gwait(450); W[0].ammo = 8; G.fire(); await gwait(80); const a = W[0].ammo; W[0].ammo = 3; G.startReload(); await gwait(2400);
    return { ok: moved > 1.2 && a === 7 && W[0].ammo === 8, detail: `전진 ${moved.toFixed(1)}m · 사격 후 ${a} · 재장전 후 ${W[0].ammo}` }; });
  await test('S4 민간인은 적과 구분: 피격 판정·표적·보상 없음', async () => {
    const noHit = civ.every((c) => c.meshes.length === 0), notListed = civ.every((c) => !G.enemies.includes(c) && !G.allies.includes(c)), noGun = civ.every((c) => { let gun = false; c.model && c.model.traverse((o) => { if (o.name && /gun|garand|thompson/i.test(o.name)) gun = true; }); return !gun; });
    const k0 = S.kills, c = civ[0]; reset(23, -9.5); await gwait(200); aimAt(c.x, c.y + 1, c.z); G.switchTo(0); await gwait(450); W[0].ammo = 8; G.fire(); await gwait(150);
    G.explode(new G.V3(c.x + 1, c.y, c.z), 6, 0, true); await gwait(300);
    return { ok: noHit && notListed && noGun && S.kills === k0 && civ.every((v) => v.state === 'hide'), detail: `피격 부위 ${noHit ? '없음' : '있음(오류)'} · 적/아군 목록 ${notListed ? '밖' : '안(오류)'} · 총 ${noGun ? '없음' : '있음'} · 사격·폭발 후 처치 수 ${S.kills - k0}` };
  });
  await test('S4 점령 건물: 벽은 막고 정문으로 들어감', async () => { reset(6, 1, -Math.PI / 2); G.keys.KeyW = true; await gwait(1500); G.keys.KeyW = false; const x1 = P.pos.x, inside = x1 > 10.6;
    reset(6, -3, -Math.PI / 2); G.keys.KeyW = true; await gwait(1500); G.keys.KeyW = false; const blocked = P.pos.x < 9.8;
    return { ok: inside && blocked, detail: `정문으로 ${inside ? '들어감' : '못 들어감'} (x ${x1.toFixed(1)}) · 벽 앞 ${blocked ? '막힘' : '통과(오류)'} (x ${P.pos.x.toFixed(1)})` }; });
  await test('S4 발코니 저격수가 큰길을 내려다봄', async () => { const sn = G.enemies.filter((e) => e.type === 'sniper'); reset(0, 50); await gwait(1500); const up = sn.every((e) => e.y - G.heightAt(e.x, e.z) > 4), seeing = sn.filter((e) => e.los).length;
    return { ok: up && seeing >= 1, detail: `높이 ${sn.map((e) => (e.y - G.heightAt(e.x, e.z)).toFixed(1)).join(', ')}m · 시야 ${seeing}/${sn.length}` }; });
  await test('S4 목표 1: 카페에서 레지스탕스 접선 → 대원 3명 출발', async () => { const held = st.ffi.every((a) => a.hold), look = st.ffi.every((a) => a.look === 'ffi'); reset(-8, 62); await gwait(500);
    return { ok: held && look && st.contact && st.ffi.every((a) => !a.hold) && G.objectives.index >= 1, detail: `대기 ${held ? 'O' : 'X'} · FFI 차림 ${look ? 'O' : 'X'} → 접선 ${st.contact ? 'O' : 'X'}` }; });
  await test('S4 목표 2: 검문소 제압', async () => { kill((e) => e.zone === 'checkpoint'); await gwait(400); return { ok: G.objectives.index >= 2, detail: `목표 ${G.objectives.index + 1}번째` }; });
  await test('S4 목표 3: 건물 진입 + 안의 적 소탕', async () => { reset(12, 1); await gwait(300); const ent = st.entered, before = G.objectives.index; kill((e) => e.zone === 'building'); await gwait(400);
    return { ok: ent && before === 2 && G.objectives.index >= 3, detail: `진입 ${ent ? 'O' : 'X'} · 소탕 전 ${before + 1} → 후 ${G.objectives.index + 1}` }; });
  await test('S4 목표 4: 민간인 발견 → 골목 확보 전엔 대기 → 대피 → 안전지대 4/4', async () => {
    reset(27, -10); await gwait(400); const found = st.found; await gwait(1500); const waited = civ.every((c) => c.state === 'hide');
    kill((e) => e.zone === 'alley'); await gwait(300); const t0 = S.time;
    while (!civ.every((c) => c.state === 'safe') && S.time - t0 < 40) await gwait(250);
    return { ok: found && waited && civ.every((c) => c.state === 'safe') && G.objectives.index >= 4, detail: `발견 ${found ? 'O' : 'X'} · 골목 확보 전 대기 ${waited ? 'O' : 'X'} · 안전 ${civ.filter((c) => c.state === 'safe').length}/4 (${(S.time - t0).toFixed(1)}초)` };
  });
  await test('S4 목표 5: 광장 소탕 + 구청 정문 3초 → 해방 · 깃발 · 기록', async () => {
    kill(() => true); reset(0, -92.6); await gwait(3600);
    const t0 = performance.now(); while (S.mode !== 'win' && performance.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
    return { ok: S.mode === 'win' && st.flagT > .9 && civ.length === 10 && G.campaign.isCompleted(4), detail: `화면 ${S.mode} · 깃발 ${(st.flagT * 100 | 0)}% · 축하 시민 ${civ.length - 4} · Stage 4 완료 저장 ${G.campaign.isCompleted(4) ? 'O' : 'X'}` };
  });
}

async function stage5Suite(G, { test, reset, gwait, P, S }) {
  const W = G.weapons, M = G.STAGE_MODULE, st = M.state, kill = (f) => { for (const e of G.enemies) if (e.alive && f(e)) G.damageEnemy(e, 9999, 'body', new G.V3(0, 0, -1), 1, null); };
  const walk = async (ms) => { G.keys.KeyW = true; await gwait(ms); G.keys.KeyW = false; };
  await test('S5 전장 구성 (적 31 · 아군 3 · 지하 벙커 바닥)', () => { const f = G.heightAt(5, -42), top = G.env.constructor && G.heightAt(5, -24);
    return { ok: G.enemies.length === 31 && G.allies.length === 3 && G.env.treeCount > 500 && f < top - 1, detail: `적 ${G.enemies.length} · 아군 ${G.allies.length} · 나무 ${G.env.treeCount} · 벙커 바닥 ${f.toFixed(1)} / 입구 위 ${top.toFixed(1)}` }; });
  await test('S5 이동·사격·재장전', async () => { reset(0, 104); const z0 = P.pos.z; await walk(600); const moved = z0 - P.pos.z; G.switchTo(0); await gwait(450); W[0].ammo = 8; G.fire(); await gwait(80); const a = W[0].ammo; W[0].ammo = 3; G.startReload(); await gwait(2400);
    return { ok: moved > 1.2 && a === 7 && W[0].ammo === 8, detail: `전진 ${moved.toFixed(1)}m · 사격 후 ${a} · 재장전 후 ${W[0].ammo}` }; });
  await test('S5 용의 이빨은 막고 길목으로만 지나감', async () => { reset(5.75, 22); await walk(3400); const passed = P.pos.z < 10, zp = P.pos.z; reset(-10, 22); await walk(2600); const blocked = P.pos.z > 17;
    return { ok: passed && blocked, detail: `길목 z ${zp.toFixed(1)} (${passed ? '통과' : '막힘'}) · 이빨 앞 z ${P.pos.z.toFixed(1)} (${blocked ? '막힘' : '통과(오류)'})` }; });
  await test('S5 목표 1: 정찰 지점에서 벙커 2곳·박격포 확인 → 분대 출발', async () => { const held = st.squad.every((a) => a.hold); reset(-34, 62);
    for (const T of [{ x: -26, z: 5 }, { x: 26, z: 3 }, { x: -2, z: -12 }]) { const t0 = S.time; while (S.time - t0 < 1.4) { P.yaw = Math.atan2(-(T.x - P.pos.x), -(T.z - P.pos.z)); await gwait(50); } }
    return { ok: held && st.recon && st.squad.every((a) => !a.hold) && G.objectives.index >= 1, detail: `대기 ${held ? 'O' : 'X'} · 확인 ${st.seen.filter((v) => v >= 1).length}/3 · 분대 출발 ${st.squad.every((a) => !a.hold) ? 'O' : 'X'}` }; });
  await test('S5 나무 위 저격수가 멀리서 봄', async () => { const sn = G.enemies.filter((e) => e.type === 'sniper'); reset(-20, 40); await gwait(1500); const d = sn.map((e) => Math.hypot(e.x - P.pos.x, e.z - P.pos.z));
    return { ok: sn.length === 2 && sn.every((e) => e.y - G.heightAt(e.x, e.z) > 5) && sn.some((e) => e.los), detail: `거리 ${d.map((v) => v.toFixed(0)).join(', ')}m · 시야 ${sn.filter((e) => e.los).length}/2` }; });
  await test('S5 목표 2: 야전 방어선 돌파', async () => { kill((e) => e.zone === 'field'); await gwait(400); return { ok: G.objectives.index >= 2, detail: `목표 ${G.objectives.index + 1}번째` }; });
  await test('S5 박격포: 포탄을 쏘고, 수류탄으로 파괴됨', async () => { reset(0, 40); st.mortarT = 0; await gwait(300); const fired = st.mortarT > 8; await gwait(1500);
    G.explode(new G.V3(-2, G.heightAt(-2, -12), -12), 6, 0, true); await gwait(300);
    return { ok: fired && st.mortarDown && G.enemies.filter((e) => e.zone === 'mortar' && e.alive).length === 0, detail: `발사 ${fired ? 'O' : 'X'} · 파괴 ${st.mortarDown ? 'O' : 'X'}` }; });
  await test('S5 목표 3: 벙커 1곳 수류탄 폭파 · 1곳 사수 사살 → 2/2', async () => { reset(0, 24); const B = (await import('../stages/stage5/layout.js')).BUNKERS;
    G.explode(B[0].slit.clone(), 6, 0, true); await gwait(300); const a = st.bunker[0]; kill((e) => e.zone === 'bunker1'); await gwait(400);
    return { ok: a && st.bunker[1] && G.objectives.index >= 3, detail: `서쪽 ${a ? '폭파' : 'X'} · 동쪽 ${st.bunker[1] ? '무력화' : 'X'}` }; });
  await test('S5 지하 벙커: 경사로로 내려가고 덮인 땅 위로는 못 들어감', async () => { reset(5, -18); await walk(4200); const z1 = P.pos.z, depth = G.heightAt(5, -20) - P.pos.y, inside = z1 < -32.5;
    reset(19, -42, Math.PI / 2); await walk(1800); const blocked = P.pos.x > 15.9;
    return { ok: inside && depth > 2.5 && blocked, detail: `경사로 끝 z ${z1.toFixed(1)} · 깊이 ${depth.toFixed(1)}m · 벙커 지붕 쪽 x ${P.pos.x.toFixed(1)} (${blocked ? '막힘' : '들어감(오류)'})` }; });
  await test('S5 지하 벙커 위에 던진 수류탄은 덮인 땅 위에 머묾', async () => { reset(19, -42, Math.PI / 2); P.pitch = -.35; P.grenades = 3; const n0 = G.grenades.length; G.throwGrenade(); await gwait(1400);
    const g = G.grenades[G.grenades.length - 1], T = await import('../stages/stage5/terrain.js'); if (!g || G.grenades.length <= n0) return { ok: false, detail: '수류탄이 나가지 않음' };
    const p = g.m.position, over = p.x < 16 && p.x > -6, top = T.displayHeight(p.x, p.z);
    return { ok: over && p.y > T.HQ_FLOOR + 2.5 && Math.abs(p.y - top) < .6, detail: `위치 (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) · 높이 ${p.y.toFixed(1)} · 덮인 땅 ${top.toFixed(1)} · 벙커 바닥 ${T.HQ_FLOOR.toFixed(1)}` }; });
  await test('S5 목표 4: 지휘 벙커 소탕 + 지휘실 2초 → 반격 5명', async () => { const n0 = G.enemies.length; kill((e) => e.zone === 'hq'); reset(11, -36); await gwait(2600);
    return { ok: st.hqHold >= 2 && st.counter && G.enemies.length === n0 + 5 && G.objectives.index >= 4, detail: `확보 ${(st.hqHold / 2 * 100) | 0}% · 적 ${n0} → ${G.enemies.length}` }; });
  await test('S5 목표 5: 요새 점령 → 증원 분대 합류 → MISSION COMPLETE · 캠페인 1부 끝', async () => {
    kill((e) => e.zone === 'final'); reset(10, -80); await gwait(600); const came = st.reinf.length === 4;
    const t0 = S.time; while (!st.linked && S.time - t0 < 30) await gwait(250); const linkT = S.time - t0;
    const w0 = performance.now(); while (S.mode !== 'win' && performance.now() - w0 < 20000) await new Promise((r) => setTimeout(r, 100));
    const title = document.getElementById('winTitle').textContent, next = document.getElementById('winNext').textContent;
    return { ok: came && st.linked && S.mode === 'win' && title === 'MISSION COMPLETE' && /END OF CAMPAIGN/.test(next) && G.campaign.isCompleted(5), detail: `증원 ${st.reinf.length}명 · 합류 ${linkT.toFixed(1)}초 · 화면 "${title}" · "${next}" · 저장 ${G.campaign.isCompleted(5) ? 'O' : 'X'}` };
  });
}
