// 시네마틱 재생기: 실제 전장 위를 카메라가 지나가며(레터박스) 영어 작전명·한국어 자막·무전 대사를 보여 준다.
// Space·Enter·Esc 또는 '건너뛰기' 버튼으로 넘길 수 있다. 대본 형식은 src/campaign/cinematics.js 참고.
import { V3 } from '../core/utils.js';

const ease = (t) => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const CSS = `
#cine{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;font-family:system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
#cine .bar{position:absolute;left:0;right:0;height:12vh;background:#000;transition:transform .9s ease}
#cine .bar.t{top:0;transform:translateY(-100%)} #cine .bar.b{bottom:0;transform:translateY(100%)}
#cine.on .bar{transform:none}
#cine .fade{position:absolute;inset:0;background:#000;opacity:1;transition:opacity .9s}
#cine .title{position:absolute;left:0;right:0;top:36%;text-align:center;color:#efe6cc;opacity:0;transition:opacity 1.1s;text-shadow:0 2px 20px #000}
#cine .title .meta{font:700 13px/1.6 system-ui;letter-spacing:.32em;color:#f0d890;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.8)}
#cine .title .en{font:700 clamp(30px,5vw,60px)/1.15 Georgia,'Times New Roman',serif;letter-spacing:.12em;margin:.15em 0}
#cine .title .ko{font:600 clamp(16px,2vw,22px)/1.6 system-ui;letter-spacing:.3em;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.8)}
#cine .sub{position:absolute;left:8%;right:8%;bottom:3.2vh;text-align:center;color:#f2eee2;font:500 clamp(14px,1.7vw,19px)/1.55 system-ui;opacity:0;transition:opacity .35s}
#cine .sub .who{display:inline-block;margin-right:.6em;padding:0 .5em;border:1px solid #8fae7a;color:#b9d79e;font-size:.8em;letter-spacing:.15em;vertical-align:.1em}
#cine .sub.radio .txt{color:#d9ecc4}
#cine .skip{position:absolute;right:2.2vw;top:calc(12vh + 14px);pointer-events:auto;background:rgba(0,0,0,.45);color:#e8e2d0;border:1px solid rgba(232,201,122,.6);font:600 12px system-ui;letter-spacing:.12em;padding:7px 12px;cursor:pointer}
#cine .skip:hover{background:rgba(232,201,122,.2)}
#cine .go{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:auto;display:none;background:rgba(0,0,0,.6);color:#efe6cc;border:1px solid #e8c97a;font:700 16px system-ui;letter-spacing:.25em;padding:16px 28px;cursor:pointer}
`;

export class CinematicPlayer {
  /** @param {{heightAt:Function, sfx:Function, music:Function}} deps */
  constructor({ heightAt, sfx, music }) {
    Object.assign(this, { heightAt, sfx, music, active: false, pos: new V3(), look: new V3(), focus: new V3(), fov: 60 });
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'cine';
    el.innerHTML = '<div class="bar t"></div><div class="bar b"></div><div class="title"><div class="meta"></div><div class="en"></div><div class="ko"></div></div><div class="sub"><span class="who"></span><span class="txt"></span></div><button class="skip">건너뛰기 ▶ (Space)</button><button class="go">클릭하여 작전 개시</button><div class="fade"></div>';
    document.body.appendChild(el);
    this.$ = (s) => el.querySelector(s);
    this.$('.skip').addEventListener('click', (e) => { e.stopPropagation(); this.finish(true); });
    this.$('.go').addEventListener('click', (e) => { e.stopPropagation(); this._go(); });
    addEventListener('keydown', (e) => { if (!this.active && !this.waiting) return; if (['Space', 'Enter', 'Escape'].includes(e.code)) { e.preventDefault(); if (this.waiting) this._go(); else this.finish(true); } });
  }
  /** 대본 재생. done(userGesture) — 사용자가 건너뛰기를 눌렀으면 true(그 자리에서 마우스 고정을 요청할 수 있음) */
  play(script, done, { waitForClick = false } = {}) {
    this.s = script; this.t = 0; this.done = done; this.waitForClick = waitForClick; this.active = true; this.waiting = false;
    this.total = script.shots.reduce((a, b) => a + b.d, 0); this.lineIdx = -1;
    const T = script.title; if (T) { this.$('.meta').textContent = T.meta || ''; this.$('.en').textContent = T.en; this.$('.ko').textContent = T.ko || ''; }
    this.$('.go').style.display = 'none'; this.$('.skip').style.display = '';
    this.el.style.display = 'block'; requestAnimationFrame(() => { this.el.classList.add('on'); this.$('.fade').style.opacity = '0'; });
    this.track = this.music(script.music, this.total + 3);
    this.update(0);
  }
  _abs(p) { return new V3(p[0], this.heightAt(p[0], p[2]) + p[1], p[2]); }
  update(dt) {
    if (!this.active) return;
    this.t += dt; const S = this.s;
    // 카메라: 현재 장면의 시작→끝 사이를 부드럽게
    let acc = 0, shot = S.shots[S.shots.length - 1], k = 1;
    for (const sh of S.shots) { if (this.t < acc + sh.d) { shot = sh; k = (this.t - acc) / sh.d; break; } acc += sh.d; }
    const e = ease(Math.min(1, Math.max(0, k)));
    if (!shot._a) { shot._a = this._abs(shot.a); shot._b = this._abs(shot.b); shot._la = this._abs(shot.la); shot._lb = this._abs(shot.lb || shot.la); }
    this.pos.lerpVectors(shot._a, shot._b, e); this.look.lerpVectors(shot._la, shot._lb, e); this.fov = shot.fov || 55;
    this.focus.lerpVectors(this.pos, this.look, .5);
    // 제목
    const T = S.title; this.$('.title').style.opacity = T && this.t > T.t && this.t < T.t + T.d ? '1' : '0';
    // 자막·무전
    const li = S.lines.findIndex((l) => this.t > l.t && this.t < l.t + l.d), sub = this.$('.sub');
    if (li !== this.lineIdx) { this.lineIdx = li; if (li >= 0) { const L = S.lines[li]; this.$('.who').textContent = L.who || ''; this.$('.who').style.display = L.who ? '' : 'none'; this.$('.txt').textContent = L.text; sub.classList.toggle('radio', !!L.radio); if (L.radio) this.sfx('radio'); } }
    sub.style.opacity = li >= 0 ? '1' : '0';
    // 끝: 검게 사라짐
    if (this.t > this.total - .9) this.$('.fade').style.opacity = '1';
    if (this.t >= this.total) this.finish(false);
  }
  finish(user) {
    if (!this.active) return; this.active = false; if (this.track) this.track.stop(user ? .6 : 1.4);
    if (this.waitForClick && !user) { this.waiting = true; this.$('.skip').style.display = 'none'; this.$('.sub').style.opacity = '0'; this.$('.title').style.opacity = '0'; this.$('.go').style.display = 'block'; this.$('.fade').style.opacity = '.55'; return; }   // 마우스 고정은 클릭에서만 요청할 수 있어 버튼을 띄운다
    this._close(user);
  }
  _go() { this.waiting = false; this._close(true); }
  _close(user) { this.el.classList.remove('on'); this.$('.fade').style.opacity = '1'; setTimeout(() => { this.el.style.display = 'none'; this.$('.fade').style.opacity = '1'; }, 50); const d = this.done; this.done = null; if (d) d(user); }
}
