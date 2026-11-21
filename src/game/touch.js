// 터치 조작(아이패드 등): 왼쪽 가상 조이스틱으로 이동, 오른쪽 화면을 끌어 시점 회전, 오른쪽 버튼으로 사격·조준·재장전·수류탄·점프·앉기·무기 교체.
// Pointer Events 로 손가락 여러 개를 따로 추적한다(조이스틱을 밀면서 사격 버튼을 누르고 끌어 조준).
// 켜지는 조건: ?touch, 또는 터치 화면 기기(?notouch 로 끔), 또는 처음 화면을 손가락으로 만졌을 때.
import { PARAMS, clamp } from '../core/utils.js';

const CSS = `
#touch { position:fixed; inset:0; display:none; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; z-index:5; }
#touch .tb { position:absolute; display:flex; align-items:center; justify-content:center; flex-direction:column; border-radius:50%;
  background:rgba(12,14,12,.38); border:2px solid rgba(232,201,122,.55); color:#efe2b8; font:700 13px "Apple SD Gothic Neo", system-ui, sans-serif;
  letter-spacing:.04em; text-shadow:0 1px 0 #000; touch-action:none; }
#touch .tb b { font-size:22px; line-height:1; margin-bottom:2px; }
#touch .tb.on { background:rgba(232,201,122,.32); border-color:#ffe3a0; }
#touch .tb.press { background:rgba(232,201,122,.45); transform:scale(.94); }
#touch .tb.fire { width:118px; height:118px; right:calc(env(safe-area-inset-right) + 34px); bottom:calc(env(safe-area-inset-bottom) + 128px); border-width:3px; border-color:rgba(255,120,90,.75); background:rgba(120,20,10,.32); font-size:15px; }
#touch .tb.fire b { font-size:30px; }
#touch .tb.aim { width:80px; height:80px; right:calc(env(safe-area-inset-right) + 170px); bottom:calc(env(safe-area-inset-bottom) + 150px); }
#touch .tb.reload { width:66px; height:66px; right:calc(env(safe-area-inset-right) + 46px); bottom:calc(env(safe-area-inset-bottom) + 272px); }
#touch .tb.nade { width:66px; height:66px; right:calc(env(safe-area-inset-right) + 140px); bottom:calc(env(safe-area-inset-bottom) + 252px); }
#touch .tb.jump { width:66px; height:66px; right:calc(env(safe-area-inset-right) + 150px); bottom:calc(env(safe-area-inset-bottom) + 40px); }
#touch .tb.crouch { width:66px; height:66px; right:calc(env(safe-area-inset-right) + 240px); bottom:calc(env(safe-area-inset-bottom) + 64px); }
#touch .tb.weapon { width:66px; height:66px; right:calc(env(safe-area-inset-right) + 54px); bottom:calc(env(safe-area-inset-bottom) + 30px); }
#touch .tb.pause { width:52px; height:52px; left:50%; margin-left:-26px; top:calc(env(safe-area-inset-top) + 12px); font-size:18px; }
#touch .stick { position:absolute; width:150px; height:150px; margin:-75px 0 0 -75px; border-radius:50%; border:2px solid rgba(232,201,122,.45); background:rgba(12,14,12,.22); display:none; pointer-events:none; }
#touch .stick.run { border-color:#ffe3a0; box-shadow:0 0 18px rgba(255,227,160,.35); }
#touch .stick i { position:absolute; left:50%; top:50%; width:64px; height:64px; margin:-32px 0 0 -32px; border-radius:50%; background:rgba(232,201,122,.5); border:2px solid #efe2b8; }
#touch .hint { position:absolute; left:calc(env(safe-area-inset-left) + 60px); bottom:calc(env(safe-area-inset-bottom) + 60px); width:150px; height:150px; border-radius:50%;
  border:2px dashed rgba(232,201,122,.28); color:rgba(239,226,184,.55); font:600 13px system-ui; display:flex; align-items:center; justify-content:center; text-align:center; pointer-events:none; }
#rotateMsg { position:fixed; inset:0; z-index:50; display:none; align-items:center; justify-content:center; flex-direction:column; background:#050605; color:#efe2b8; font:700 20px "Apple SD Gothic Neo", system-ui, sans-serif; text-align:center; gap:14px; }
#rotateMsg b { font-size:54px; }
@media (orientation: portrait) { body.touch #rotateMsg { display:flex; } }
/* HUD 를 손가락이 가리지 않는 곳으로 */
body.touch #health { left:auto; right:calc(50% + 30px); bottom:calc(env(safe-area-inset-bottom) + 10px); }
body.touch #ammo { right:auto; left:calc(50% + 30px); text-align:left; bottom:calc(env(safe-area-inset-bottom) + 10px); }
body.touch .big { font-size:34px; } body.touch .big small { font-size:16px; }
body.touch #hpbar { width:150px; }
body.touch #slots { display:none; }
body.touch #objective { max-width:min(380px, 40vw); top:calc(env(safe-area-inset-top) + 10px); }
body.touch #enemies { top:calc(env(safe-area-inset-top) + 74px); }
body.touch .kbonly { display:none !important; }
body:not(.touch) .touchonly { display:none !important; }
`;

/**
 * @param {object} o 게임 쪽 함수들
 *  active() 지금 전투 조작을 받는가 · look(dx, dy) 화면 픽셀 단위 · fire(down) · aim() · reload() · grenade() · crouch() · jump(down) · weapon() · pause()
 *  state() → { crouch, aim } 버튼 불빛 표시용 · onEnable() 처음 켜질 때 한 번
 */
export function createTouchControls(o) {
  const T = { enabled: false, f: 0, s: 0, sprint: false, looking: false, enable, update, reset };
  const off = PARAMS.has('notouch');
  let el = null, stickEl = null, knob = null, hint = null;
  const ptr = new Map();   // pointerId → { kind: 'stick'|'look'|'btn', x, y, ox, oy, act }
  const R = 64;

  function build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'touch';
    el.innerHTML = `<div class="hint">왼쪽을 누르고<br>밀어서 이동</div><div class="stick"><i></i></div>
      <div class="tb fire" data-act="fire"><b>◎</b>사격</div><div class="tb aim" data-act="aim"><b>⊕</b>조준</div>
      <div class="tb reload" data-act="reload"><b>↻</b>장전</div><div class="tb nade" data-act="nade"><b>●</b>수류탄</div>
      <div class="tb jump" data-act="jump"><b>⤒</b>점프</div><div class="tb crouch" data-act="crouch"><b>⤓</b>앉기</div>
      <div class="tb weapon" data-act="weapon"><b>⇄</b>무기</div><div class="tb pause" data-act="pause">❚❚</div>`;
    const hud = document.getElementById('hud'); hud.parentNode.insertBefore(el, hud.nextSibling);
    stickEl = el.querySelector('.stick'); knob = stickEl.querySelector('i'); hint = el.querySelector('.hint');
    const rot = document.createElement('div'); rot.id = 'rotateMsg'; rot.innerHTML = '<b>⟲</b>아이패드를 가로로 돌려 주세요'; document.body.appendChild(rot);
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointermove', move, { passive: false });
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: 두 손가락 확대·두 번 탭 확대 막기
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }
  function enable() {
    if (T.enabled || off) return; T.enabled = true;
    document.body.classList.add('touch'); build(); if (o.onEnable) o.onEnable();
  }
  function down(e) {
    e.preventDefault(); if (!o.active()) return;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignored */ }
    const b = e.target.closest('.tb'), p = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, kind: 'look', act: null, b };
    if (b) {
      p.kind = 'btn'; p.act = b.dataset.act; b.classList.add('press');
      switch (p.act) {
        case 'fire': o.fire(true); p.kind = 'firelook'; break;   // 사격 버튼을 누른 채 끌면 시점도 돈다
        case 'aim': o.aim(); break;
        case 'reload': o.reload(); break;
        case 'nade': o.grenade(); break;
        case 'jump': o.jump(true); break;
        case 'crouch': o.crouch(); break;
        case 'weapon': o.weapon(); break;
        case 'pause': o.pause(); break;
      }
    } else if (e.clientX < innerWidth * .45 && ![...ptr.values()].some((q) => q.kind === 'stick')) {
      p.kind = 'stick'; stickEl.style.display = 'block'; stickEl.style.left = p.ox + 'px'; stickEl.style.top = p.oy + 'px'; knob.style.transform = ''; hint.style.display = 'none';
    }
    ptr.set(e.pointerId, p);
    if (p.kind === 'look' || p.kind === 'firelook') T.looking = true;
  }
  function move(e) {
    const p = ptr.get(e.pointerId); if (!p) return; e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (p.kind === 'stick') {
      let vx = p.x - p.ox, vy = p.y - p.oy; const L = Math.hypot(vx, vy), k = L > R ? R / L : 1;
      knob.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
      const m = L < R * .14 ? 0 : Math.min(1, L / R);   // 가운데 조금은 무시
      T.f = L ? clamp(-vy / L * m, -1, 1) : 0; T.s = L ? clamp(vx / L * m, -1, 1) : 0;
      T.sprint = L > R * 1.35 && T.f > .6;   // 고리 밖까지 앞으로 밀면 질주
      stickEl.classList.toggle('run', T.sprint);
    } else if ((p.kind === 'look' || p.kind === 'firelook') && o.active()) o.look(dx, dy);
  }
  function up(e) {
    const p = ptr.get(e.pointerId); if (!p) return; ptr.delete(e.pointerId);
    if (p.b) p.b.classList.remove('press');
    if (p.kind === 'stick') { T.f = T.s = 0; T.sprint = false; stickEl.style.display = 'none'; stickEl.classList.remove('run'); }
    if (p.act === 'fire') o.fire(false);
    if (p.act === 'jump') o.jump(false);
    T.looking = [...ptr.values()].some((q) => q.kind === 'look' || q.kind === 'firelook');
  }
  /** 손가락을 모두 뗀 것으로(일시정지·전사·시네마틱으로 화면이 바뀔 때) */
  function reset() {
    for (const [id, p] of ptr) { if (p.b) p.b.classList.remove('press'); if (p.act === 'fire') o.fire(false); if (p.act === 'jump') o.jump(false); try { el.releasePointerCapture(id); } catch (_) { /* ignored */ } }
    ptr.clear(); T.f = T.s = 0; T.sprint = false; T.looking = false; if (stickEl) { stickEl.style.display = 'none'; stickEl.classList.remove('run'); }
  }
  let shown = false; const portrait = matchMedia('(orientation: portrait)');
  /** 매 프레임: 보일지 결정하고 버튼 불빛 갱신 */
  function update() {
    if (!T.enabled) return;
    const want = o.active(); if (want !== shown) { shown = want; el.style.display = want ? 'block' : 'none'; if (!want) reset(); }
    if (!want) return;
    if (portrait.matches) { o.pause(); return; }   // 세로로 돌리면 일시정지(가로로 돌려 달라는 안내가 뜬다)
    const s = o.state(); el.querySelector('.crouch').classList.toggle('on', !!s.crouch); el.querySelector('.aim').classList.toggle('on', !!s.aim);
  }
  if (!off) {
    if (PARAMS.has('touch') || (navigator.maxTouchPoints > 0 && matchMedia('(any-pointer: coarse)').matches)) enable();
    else addEventListener('touchstart', enable, { once: true, passive: true });
  }
  return T;
}
