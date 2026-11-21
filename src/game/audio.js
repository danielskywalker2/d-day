// 효과음 — 실제 총성 녹음(CC0, assets/audio) + Web Audio 합성 레이어. 게임 로직은 sfx(이름, ...) 만 호출한다.
//   총성: 녹음 샘플(무기마다 다른 총) 위에 저음 타격·기계음을 덧대고, 야외 잔향과 절벽 메아리로 보낸다.
//   먼 총성: 거리만큼 늦게(초속 343m) 도착하고, 멀수록 고음이 빠지고 잔향 비율이 커진다.
//   동시 발음 수를 종류별로 제한해 소리가 쌓여 뭉개지거나 과부하되지 않게 한다.
//   샘플을 못 불러오면 예전 합성음으로 대신한다.
import { rand, clamp } from '../core/utils.js';

/** 녹음 샘플 — 이름: 변형 개수 */
const SAMPLES = { garand: 2, springfield: 2, thompson: 3, trench: 2, mg42: 3, mp40: 2, kar98k: 2 };
/** 종류별 동시 발음 상한 (넘으면 새 소리를 버리거나 가장 오래된 것을 줄인다) */
const CAPS = { player: 6, enemy: 14, impact: 8, boom: 5, mech: 6, distant: 6, misc: 10 };
const C_SOUND = 343;

/** @param {() => {x:number, z:number, yaw:number}} listener 3D 소리의 기준 위치(플레이어) */
/** opts.ambience: 'beach'(파도) | 'field'(바람) */
export function createAudio(listener, opts = {}) {
  let AC = null, master, reverb, echoIn, noiseBuf, shockF, ringG;
  const buffers = {}, raw = {};
  const voices = {}; for (const k in CAPS) voices[k] = [];
  const stats = { played: 0, dropped: 0, stolen: 0 };
  // 샘플은 미리 받아 두고(소리 켜기 전), AudioContext 가 생기면 해독한다
  for (const [n, c] of Object.entries(SAMPLES)) for (let i = 1; i <= c; i++) { const k = `${n}_${i}`; raw[k] = fetch(`./assets/audio/${k}.m4a`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null); }
  async function decodeAll() {
    await Promise.all(Object.entries(raw).map(async ([k, p]) => { const ab = await p; if (!ab) return; try { const b = await AC.decodeAudioData(ab.slice(0)); const n = k.replace(/_\d+$/, ''); (buffers[n] || (buffers[n] = [])).push(b); } catch (e) { /* 해독 실패 → 합성음 */ } }));
  }

  function init() {
    if (AC) { AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const comp = AC.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.18; comp.connect(AC.destination);
      // 가까운 폭발의 충격: 전체를 먹먹하게(저역 통과) 했다가 풀고, 귀울림을 얹는다
      shockF = AC.createBiquadFilter(); shockF.type = 'lowpass'; shockF.frequency.value = 20000; shockF.Q.value = .5; shockF.connect(comp);
      master = AC.createGain(); master.gain.value = 0.8; master.connect(shockF);
      const ring = AC.createOscillator(); ring.frequency.value = 3700; ringG = AC.createGain(); ringG.gain.value = 0; ring.connect(ringG); ringG.connect(comp); ring.start();
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // 야외 잔향: 지면·방파제의 짧은 초기 반사 몇 개 + 점점 어두워지며 사라지는 넓은 꼬리(실내처럼 촘촘하지 않게)
      const sr = AC.sampleRate, len = sr * 2.8 | 0, ir = AC.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch); let lp = 0;
        for (let i = 0; i < len; i++) { const t = i / sr, k = .08 + .5 * Math.exp(-t * 2.2); lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.exp(-t * 2.1) * .55 * Math.min(1, t / .04); }
        for (const [t, a] of [[.006, .5], [.019, .32], [.043, .26], [.071, .2], [.118, .14]]) { const i = (t + ch * .0031) * sr | 0; for (let j = 0; j < 40; j++) d[i + j] += a * (Math.random() * 2 - 1) * (1 - j / 40); }
      }
      reverb = AC.createConvolver(); reverb.buffer = ir; const rg = AC.createGain(); rg.gain.value = 0.75; reverb.connect(rg); rg.connect(master);
      // 절벽 메아리: 0.42초·0.95초 뒤에 고음이 빠진 채 돌아온다
      echoIn = AC.createGain(); echoIn.gain.value = 1;
      for (const [dt, f, g, pan] of [[.42, 1700, .32, -.35], [.95, 950, .2, .4]]) {
        const dl = AC.createDelay(2); dl.delayTime.value = dt; const lf = AC.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = f; const eg = AC.createGain(); eg.gain.value = g;
        const fb = AC.createGain(); fb.gain.value = .16; echoIn.connect(dl); dl.connect(lf); lf.connect(eg); lf.connect(fb); fb.connect(dl);
        let last = eg; if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = pan; eg.connect(p); last = p; } last.connect(master); last.connect(reverb);
      }
      // 배경음: 해변은 파도(낮은 소음이 천천히 밀려왔다 빠짐), 들판은 바람(더 높고 옅은 소음)
      const field = opts.ambience === 'field';
      const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = AC.createBiquadFilter(); f.type = field ? 'bandpass' : 'lowpass'; f.frequency.value = field ? 900 : 500; if (field) f.Q.value = .4;
      const g = AC.createGain(); g.gain.value = field ? 0.022 : 0.05; const lfo = AC.createOscillator(); lfo.frequency.value = 0.13; const lg = AC.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); lfo.start();
      s.connect(f); f.connect(g); g.connect(master); s.start();
      decodeAll();
    } catch (e) { AC = null; }
  }

  // ---------------------------------------------------------------- 발음 관리
  /** 종류별 상한 확인. steal=true 면 가장 오래된 소리를 빠르게 줄이고 자리를 뺏는다. 허용되면 소리를 매달 출력 노드(gain)를 준다 */
  function voice(cat, dur, steal = false) {
    const now = AC.currentTime, list = voices[cat];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= now) list.splice(i, 1);
    if (list.length >= CAPS[cat]) {
      if (!steal) { stats.dropped++; return null; }
      const old = list.shift(); old.g.gain.cancelScheduledValues(now); old.g.gain.setTargetAtTime(0, now, .015); stats.stolen++;
    }
    const g = AC.createGain(); list.push({ end: now + dur, g }); stats.played++; return g;
  }
  /** 출력 묶음: 볼륨·좌우·잔향·메아리 보내기. src 는 voice() 가 준 노드(없으면 새로) */
  function bus(vol = 1, pan = 0, wet = 0, src = null, echo = 0) {
    const g = src || AC.createGain(); if (src) src.gain.value = vol; else g.gain.value = vol; let last = g;
    if (pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); last = p; }
    last.connect(master);
    if (wet > 0) { const w = AC.createGain(); w.gain.value = wet; last.connect(w); w.connect(reverb); }
    if (echo > 0) { const e = AC.createGain(); e.gain.value = echo; last.connect(e); e.connect(echoIn); }
    return g;
  }
  function nz(dest, { t = 0, dur, gain = 1, type = 'lowpass', f0 = 4000, f1 = 400, q = 0.8 }) {
    const t0 = AC.currentTime + t, s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = AC.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.03);
  }
  function tn(dest, { t = 0, dur, gain = 1, f0, f1 = f0, type = 'sine' }) {
    const t0 = AC.currentTime + t, o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  /** 녹음 샘플 재생(변형 중 무작위, 재생 속도 ±rate). lp 를 주면 고음을 깎는다. 샘플이 없으면 false */
  function smp(name, dest, { t = 0, gain = 1, rate = 1, jitter = .04, lp = 0 } = {}) {
    const list = buffers[name]; if (!list || !list.length) return false;
    const s = AC.createBufferSource(); s.buffer = list[Math.random() * list.length | 0]; s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = AC.createGain(); g.gain.value = gain; let last = s;
    if (lp) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = .6; s.connect(f); last = f; }
    last.connect(g); g.connect(dest); s.start(AC.currentTime + t); return true;
  }
  /** 거리 감쇠·좌우·공기 흡수·도착 지연(음속) */
  function spat(pos) {
    const L = listener(), dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz) + 0.001;
    return { d, vol: 1.6 / (1 + Math.pow(d / 8, 1.1)),   // 10m → 0.72, 30m → 0.34, 90m → 0.11
       pan: ((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.85, delay: d / C_SOUND, lp: clamp(19000 * Math.exp(-d / 38), 700, 19000), wet: clamp(.25 + d / 110, .25, .9) };
  }
  /** 총구 저음 타격 + 기계음 레이어(녹음 위에 '손에 오는' 무게감) */
  const thump = (b, f0, f1, dur, gain) => tn(b, { dur, gain, f0, f1 });

  const SFX = {
    // ------------------------------------------------ 플레이어 총성 (녹음 + 레이어)
    garand() { const v = voice('player', 1.2, true); if (!v) return; const b = bus(1, 0, .42, v, .3);
      if (!smp('garand', b, { gain: 1.05 })) { nz(b, { dur: .3, gain: 1.5, f0: 6500, f1: 380 }); nz(b, { dur: .05, gain: 1.2, type: 'highpass', f0: 2500, f1: 5000 }); }
      thump(b, 160, 44, .2, 1.1); nz(b, { t: .028, dur: .045, gain: .35, type: 'bandpass', f0: 2300, f1: 1500, q: 3 }); },   // 조작간이 되돌아오는 금속음
    thompson() { const v = voice('player', .6, true); if (!v) return; const b = bus(1.2, 0, .28, v, .14);
      if (!smp('thompson', b, { gain: 1.35, rate: .93 })) { nz(b, { dur: .14, gain: 1.3, f0: 3800, f1: 480 }); nz(b, { dur: .03, gain: .8, type: 'highpass', f0: 3000, f1: 4000 }); }
      thump(b, 120, 50, .1, .9); nz(b, { t: .012, dur: .035, gain: .4, type: 'bandpass', f0: 1100, f1: 700, q: 2.5 }); },     // 무거운 노리쇠가 닫히는 소리 (.45 ACP 의 둔탁함: 재생 속도 0.93)
    trench() { const v = voice('player', 1.4, true); if (!v) return; const b = bus(1.1, 0, .55, v, .38);
      if (!smp('trench', b, { gain: 1.1 })) { nz(b, { dur: .5, gain: 1.9, f0: 4200, f1: 180 }); nz(b, { dur: .07, gain: 1.2, type: 'highpass', f0: 1800, f1: 3500 }); }
      thump(b, 115, 28, .38, 1.9); tn(b, { dur: .12, gain: .6, f0: 300, f1: 60, type: 'triangle' }); },
    // M1903A4: 녹음 + 긴 메아리(절벽 반사)
    springfield() { const v = voice('player', 1.6, true); if (!v) return; const b = bus(1.15, 0, .8, v, .7);
      if (!smp('springfield', b, { gain: 1.1, rate: .96 })) { nz(b, { dur: .05, gain: 1.6, type: 'highpass', f0: 3200, f1: 6000 }); nz(b, { dur: .55, gain: 2.1, f0: 7500, f1: 220 }); }
      thump(b, 150, 30, .45, 2); tn(b, { dur: .18, gain: .7, f0: 420, f1: 90, type: 'triangle' }); },
    // ------------------------------------------------ 다른 병사의 총성 (거리·지연·공기 흡수)
    enemyShot(type, pos) {
      const s = spat(pos), name = type === 'mg' ? 'mg42' : type === 'smg' ? 'mp40' : type === 'garand' ? 'garand' : 'kar98k';
      const loud = { mg42: 1.05, mp40: 1.9, kar98k: 1.55, garand: .85 }[name];
      const v = voice('enemy', 1.8 + s.delay); if (!v) return;
      const b = bus(clamp(s.vol * loud, 0, 1.4), s.pan, s.wet, v, clamp(s.d / 90, .08, .6));
      // MG42: 분당 1,200발의 찢는 소리 — 무거운 소총탄 녹음을 조금 낮게, 아주 짧게 끊어 겹친다
      const ok = smp(name, b, { t: s.delay, gain: 1, rate: name === 'mg42' ? .9 : 1, jitter: .05, lp: s.lp });
      if (!ok) { const lp = clamp(5000 - s.d * 45, 700, 5000); nz(b, { t: s.delay, dur: type === 'mg' ? .075 : .26, gain: 1.3, f0: lp, f1: 300 }); tn(b, { t: s.delay, dur: .12, gain: .9, f0: 145, f1: 45 }); }
      if (s.d < 30) thump(b, type === 'mg' ? 140 : 120, 45, .1, .5);
    },
    // 전장 저편의 총성(분위기): 녹음을 아주 어둡게, 멀리서
    distant() {
      const v = voice('distant', 2.5); if (!v) return; const b = bus(rand(.05, .13), rand(-1, 1), .9, v, .5), lp = rand(700, 1500);
      const r = Math.random();
      if (r < .4) { const n = 4 + (Math.random() * 9 | 0); for (let i = 0; i < n; i++) if (!smp('mg42', b, { t: i * .05, lp, rate: .88 })) nz(b, { t: i * .05, dur: .13, gain: 1, f0: 900, f1: 140 }); }
      else if (r < .75) { if (!smp(Math.random() < .5 ? 'kar98k' : 'garand', b, { lp, gain: 1.4 })) nz(b, { dur: .2, gain: 1, f0: 900, f1: 140 }); }
      else { const n = 3 + (Math.random() * 5 | 0); for (let i = 0; i < n; i++) smp('mp40', b, { t: i * .11, lp, gain: 1.6 }); }
      if (Math.random() < .2) tn(b, { t: .1, dur: 1.1, gain: 1.8, f0: 60, f1: 24 });
    },
    // ------------------------------------------------ 탄착음 (재질별)
    impact(surface, pos) {
      const s = spat(pos); if (s.d > 70) return; const v = voice('impact', .6); if (!v) return; const b = bus(clamp(s.vol * 1.1, 0, .9), s.pan, .25, v), t = s.delay;
      if (surface === 'metal') { const f = rand(2200, 4200); tn(b, { t, dur: .35, gain: .45, f0: f, f1: f * .985, type: 'triangle' }); tn(b, { t, dur: .2, gain: .25, f0: f * 1.47 }); nz(b, { t, dur: .04, gain: .9, type: 'highpass', f0: 3000, f1: 6000 });
        if (Math.random() < .35) { nz(b, { t: t + .02, dur: .45, gain: .35, type: 'bandpass', f0: 5200, f1: 1100, q: 7 }); } }   // 도탄 휘파람
      else if (surface === 'concrete') { nz(b, { t, dur: .06, gain: 1.1, type: 'bandpass', f0: 2600, f1: 1400, q: 1.2 }); for (let i = 0; i < 3; i++) nz(b, { t: t + .04 + i * rand(.03, .06), dur: .03, gain: .35, type: 'bandpass', f0: 3500, f1: 2500, q: 3 }); }   // 깨지는 소리 + 부스러기
      else if (surface === 'wood') { tn(b, { t, dur: .09, gain: .8, f0: 340, f1: 180, type: 'triangle' }); nz(b, { t, dur: .07, gain: .9, type: 'bandpass', f0: 1300, f1: 700, q: 1.5 }); }
      else if (surface === 'water') { nz(b, { t, dur: .22, gain: .9, type: 'bandpass', f0: 1800, f1: 500, q: .8 }); }
      else { nz(b, { t, dur: .1, gain: 1, f0: 900, f1: 180 }); nz(b, { t: t + .03, dur: .25, gain: .25, type: 'bandpass', f0: 2500, f1: 1200, q: .6 }); }   // 모래: 둔탁한 '퍽' + 흩어지는 알갱이
    },
    // ------------------------------------------------ 폭발: 파열음 → 몸통 → 초저음 → 흙비, 거리만큼 늦게, 메아리
    boom(pos, big = 1) {
      const s = spat(pos), v = voice('boom', 3 + s.delay, true); if (!v) return;
      const b = bus(clamp(s.vol * 2.2 * big, 0, 1.7), s.pan, clamp(s.wet + .2, .4, 1), v, .6), t = s.delay, lp = Math.max(1200, s.lp);
      nz(b, { t, dur: .09, gain: 1.6, type: 'highpass', f0: 900, f1: 2600 });                // 파열
      nz(b, { t, dur: 1.5, gain: 1.9, f0: Math.min(2800, lp), f1: 45 });                         // 몸통
      tn(b, { t, dur: 1.1, gain: 2.2, f0: 78, f1: 19 }); tn(b, { t, dur: .5, gain: 1.1, f0: 140, f1: 40, type: 'triangle' });   // 초저음
      nz(b, { t: t + .2, dur: 1.6, gain: .4, type: 'bandpass', f0: 2600, f1: 700, q: .4 });         // 굴러가는 잔향
      if (s.d < 45) for (let i = 0; i < 9; i++) nz(b, { t: t + rand(.35, 1.6), dur: rand(.03, .07), gain: rand(.15, .4), type: 'bandpass', f0: rand(1500, 3500), f1: 900, q: 2 });   // 떨어지는 흙·돌
    },
    /** 가까운 폭발의 충격: k(0~1)만큼 먹먹해지고 귀가 울린다 */
    shock(k) {
      const now = AC.currentTime, f = shockF.frequency; f.cancelScheduledValues(now); f.setValueAtTime(Math.max(380, 20000 * (1 - k * .985)), now); f.setTargetAtTime(20000, now + .25 + k * .6, .5 + k * .8);
      const g = ringG.gain; g.cancelScheduledValues(now); g.setValueAtTime(.02 * k, now); g.setTargetAtTime(0, now + .3, .6 + k);
    },
    ping() { const b = bus(.5, .2, 0.25); tn(b, { dur: .7, gain: .5, f0: 2740, f1: 2700 }); tn(b, { dur: .5, gain: .25, f0: 4350, f1: 4300 }); tn(b, { dur: .25, gain: .2, f0: 6900 }); },
    pump() { const b = bus(.55); nz(b, { dur: .06, gain: .9, type: 'bandpass', f0: 1800, f1: 900, q: 2 }); nz(b, { t: .13, dur: .07, gain: 1, type: 'bandpass', f0: 1300, f1: 2400, q: 2 }); },
    click() { const b = bus(.4); nz(b, { dur: .03, gain: .8, type: 'bandpass', f0: 3200, f1: 2200, q: 3 }); },
    reloadA() { const b = bus(.5); nz(b, { dur: .05, gain: .8, type: 'bandpass', f0: 1500, f1: 800, q: 2 }); tn(b, { dur: .04, gain: .3, f0: 900, f1: 500, type: 'square' }); },
    reloadB() { const b = bus(.6); nz(b, { dur: .06, gain: 1, type: 'bandpass', f0: 2600, f1: 1200, q: 2 }); tn(b, { dur: .05, gain: .35, f0: 1400, f1: 700, type: 'square' }); },
    hit() { const b = bus(.5); tn(b, { dur: .05, gain: .7, f0: 1900, f1: 1300, type: 'square' }); nz(b, { dur: .07, gain: .9, f0: 900, f1: 200 }); },
    head() { const b = bus(.6, 0, .2); tn(b, { dur: .25, gain: .6, f0: 3300, f1: 2900, type: 'triangle' }); tn(b, { dur: .12, gain: .5, f0: 5100 }); nz(b, { dur: .08, gain: 1, f0: 1200, f1: 200 }); },
    kill() { const b = bus(.5); tn(b, { dur: .09, gain: .6, f0: 520, f1: 780, type: 'triangle' }); tn(b, { t: .07, dur: .14, gain: .6, f0: 780, f1: 1040, type: 'triangle' }); },
    hurt() { const b = bus(.9); tn(b, { dur: .16, gain: 1.2, f0: 110, f1: 40 }); nz(b, { dur: .12, gain: .9, f0: 700, f1: 150 }); },
    pickup() { const b = bus(.4); tn(b, { dur: .08, gain: .5, f0: 660, type: 'triangle' }); tn(b, { t: .07, dur: .14, gain: .5, f0: 990, type: 'triangle' }); },
    step(wet) { const b = bus(.16); wet ? nz(b, { dur: .16, gain: 1, type: 'bandpass', f0: 1500, f1: 500, q: .6 }) : nz(b, { dur: .07, gain: 1, f0: 700, f1: 160 }); },
    whiz(pan) { const b = bus(.35, pan); nz(b, { dur: .13, gain: 1, type: 'bandpass', f0: 5200, f1: 1400, q: 5 }); },
    whistle(pos) { const s = spat(pos), b = bus(clamp(s.vol * 1.5, 0, .5), s.pan, .2); tn(b, { dur: 1.05, gain: .25, f0: 2300, f1: 520 }); nz(b, { dur: 1.05, gain: .12, type: 'bandpass', f0: 3000, f1: 800, q: 4 }); },
    // --- M1903A4: 날카로운 파열음 + 묵직한 저음 + 긴 잔향, 절벽에 부딪혀 돌아오는 메아리 두 번
    boltUp() { const b = bus(.45, .25); nz(b, { dur: .035, gain: 1, type: 'bandpass', f0: 3800, f1: 2600, q: 4 }); tn(b, { dur: .03, gain: .25, f0: 1800, f1: 1200, type: 'square' }); },
    boltBack() { const b = bus(.55, .25); nz(b, { dur: .11, gain: 1, type: 'bandpass', f0: 1700, f1: 3400, q: 2.5 }); nz(b, { t: .1, dur: .04, gain: .9, type: 'bandpass', f0: 2600, f1: 1800, q: 3 }); },
    boltFwd() { const b = bus(.6, .2); nz(b, { dur: .09, gain: 1, type: 'bandpass', f0: 3000, f1: 1500, q: 2.5 }); nz(b, { t: .085, dur: .05, gain: 1.2, type: 'bandpass', f0: 1500, f1: 900, q: 2 }); tn(b, { t: .085, dur: .04, gain: .35, f0: 700, f1: 380, type: 'square' }); },
    boltDown() { const b = bus(.5, .25); nz(b, { dur: .04, gain: 1.1, type: 'bandpass', f0: 2400, f1: 1500, q: 3 }); tn(b, { dur: .035, gain: .3, f0: 1100, f1: 600, type: 'square' }); },
    casing() { const b = bus(.22, rand(.2, .6), .2); for (const [t, f] of [[0, 5200], [.09, 6100], [.16, 5600], [.21, 6400]]) tn(b, { t, dur: .07, gain: .35, f0: f, f1: f * .97, type: 'triangle' }); },
    magOut() { const b = bus(.5, -.2); nz(b, { dur: .07, gain: 1, type: 'bandpass', f0: 1200, f1: 700, q: 2 }); tn(b, { dur: .05, gain: .3, f0: 600, f1: 300, type: 'square' }); },
    magIn() { const b = bus(.6, -.2); nz(b, { dur: .05, gain: 1.2, type: 'bandpass', f0: 1600, f1: 900, q: 2 }); nz(b, { t: .05, dur: .05, gain: 1.2, type: 'bandpass', f0: 2400, f1: 1400, q: 3 }); },
    clipIn() { const b = bus(.6); nz(b, { dur: .06, gain: 1, type: 'bandpass', f0: 2600, f1: 1400, q: 3 }); tn(b, { t: .04, dur: .08, gain: .3, f0: 2900, f1: 2700, type: 'triangle' }); },
    shellIn() { const b = bus(.45, -.1); nz(b, { dur: .06, gain: 1, type: 'bandpass', f0: 1300, f1: 800, q: 2 }); tn(b, { t: .03, dur: .04, gain: .25, f0: 900, f1: 500, type: 'square' }); },
    roundIn() { const b = bus(.4, .1); nz(b, { dur: .05, gain: 1, type: 'bandpass', f0: 2600, f1: 1600, q: 3 }); tn(b, { t: .02, dur: .06, gain: .25, f0: 3300, f1: 3100, type: 'triangle' }); },
    pumpBack() { const b = bus(.6, -.1); nz(b, { dur: .09, gain: 1.1, type: 'bandpass', f0: 1900, f1: 900, q: 2 }); tn(b, { dur: .05, gain: .3, f0: 500, f1: 260, type: 'square' }); },
    pumpFwd() { const b = bus(.65, -.1); nz(b, { dur: .08, gain: 1.2, type: 'bandpass', f0: 1200, f1: 2400, q: 2 }); nz(b, { t: .07, dur: .04, gain: 1, type: 'bandpass', f0: 2600, f1: 1800, q: 3 }); },
    cloth() { const b = bus(.18); nz(b, { dur: .22, gain: 1, type: 'bandpass', f0: 700, f1: 1400, q: .5 }); },
    scopeIn() { const b = bus(.2); nz(b, { dur: .12, gain: 1, type: 'bandpass', f0: 600, f1: 1100, q: .7 }); },
    breathIn() { const b = bus(.16); nz(b, { dur: .45, gain: 1, type: 'bandpass', f0: 900, f1: 1500, q: .6 }); },
    /** 교회 종(해방 장면): 낮은 기본음 + 맑지 않은 배음, 길게 울림 */
    bell(k = 1) { const b = bus(.32 * k, rand(-.3, .3), .5, null, .4), f = rand(196, 262); for (const [m, g, d] of [[.5, .5, 4.5], [1, 1, 3.6], [1.19, .55, 2.6], [1.5, .4, 2.2], [2, .45, 2.0], [2.74, .2, 1.2], [3.76, .12, .8]]) tn(b, { dur: d, gain: g * .35, f0: f * m, f1: f * m * .998 }); nz(b, { dur: .05, gain: .5, type: 'bandpass', f0: 2400, f1: 1500, q: 2 }); },
    breathOut() { const b = bus(.2); nz(b, { dur: .7, gain: 1, type: 'bandpass', f0: 1300, f1: 600, q: .6 }); },
  };
  // ---------------------------------------------------------------- 연출용 배경 음악(합성): 현악 화음 + 팀파니 + 작은북 + 선율
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PIECES = {
    tense: { step: 2.4, chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], pad: .2, bright: 1100, timp: true, snare: true, mel: null },        // 가단조: 상륙·공격 전
    somber: { step: 3.2, chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]], pad: .18, bright: 850, timp: false, snare: false, mel: [69, 65, 67, 64, 62, 65, 64, 61] },   // 라단조: 전투 뒤
    triumph: { step: 2.6, chords: [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]], pad: .2, bright: 1500, timp: true, snare: true, mel: [72, 71, 69, 72, 74, 71, 72, 77] },    // 다장조: 해방
  };
  /** 배경 음악을 len 초 동안 재생. stop(f) 로 f 초에 걸쳐 줄이며 끝낸다 */
  function music(kind = 'tense', len = 24) {
    if (!AC) return { stop() {} };
    const P = PIECES[kind] || PIECES.tense, out = AC.createGain(), t0 = AC.currentTime + .05; out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(.55, t0 + 1.5); out.connect(master);
    const wet = AC.createGain(); wet.gain.value = .5; out.connect(wet); wet.connect(reverb);
    for (let i = 0, t = 0; t < len; i++, t += P.step) {
      const ch = P.chords[i % P.chords.length], s = t0 + t;
      for (const m of ch) for (const det of [-7, 7]) {
        const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = P.bright; f.Q.value = .3; const g = AC.createGain(), v = P.pad / ch.length;
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(v, s + P.step * .4); g.gain.linearRampToValueAtTime(v * .75, s + P.step * .95); g.gain.linearRampToValueAtTime(0, s + P.step + .5);
        o.connect(f); f.connect(g); g.connect(out); o.start(s); o.stop(s + P.step + .6);
      }
      { const o = AC.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(ch[0] - 12); const g = AC.createGain(); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.12, s + .3); g.gain.linearRampToValueAtTime(0, s + P.step + .3); o.connect(g); g.connect(out); o.start(s); o.stop(s + P.step + .4); }   // 저음
      const off = s - AC.currentTime;
      if (P.timp) { tn(out, { t: off, dur: 1.4, gain: .5, f0: mtof(ch[0] - 24) * 1.02, f1: mtof(ch[0] - 24) }); nz(out, { t: off, dur: .25, gain: .12, f0: 300, f1: 80 }); }
      if (P.snare && i % 2 === 1) for (let k = 0; k < 10; k++) nz(out, { t: off + P.step * .5 + k * P.step * .05, dur: .06, gain: .03 + k * .012, type: 'bandpass', f0: 2600, f1: 1800, q: 1.2 });   // 작은북 롤
      if (P.mel) { const m = P.mel[i % P.mel.length], o = AC.createOscillator(), vib = AC.createOscillator(), vg = AC.createGain(); o.type = 'triangle'; o.frequency.value = mtof(m); vib.frequency.value = 5; vg.gain.value = 4; vib.connect(vg); vg.connect(o.frequency);
        const g = AC.createGain(); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.09, s + .35); g.gain.linearRampToValueAtTime(.06, s + P.step * .8); g.gain.linearRampToValueAtTime(0, s + P.step); o.connect(g); g.connect(out); o.start(s); vib.start(s); o.stop(s + P.step + .1); vib.stop(s + P.step + .1); }
    }
    let stopped = false;
    return { stop(f = 1.2) { if (stopped) return; stopped = true; const n = AC.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + f); setTimeout(() => out.disconnect(), f * 1000 + 300); } };
  }
  SFX.radio = () => { const b = bus(.35, 0, .05); nz(b, { dur: .22, gain: .9, type: 'bandpass', f0: 2200, f1: 1400, q: 1.5 }); tn(b, { t: .02, dur: .08, gain: .25, f0: 1250, type: 'square' }); nz(b, { t: .25, dur: 1.2, gain: .12, type: 'bandpass', f0: 1800, f1: 1600, q: .8 }); };   // 무전 잡음 + 삑
  /** 기계음·UI 처럼 발음 관리가 필요 없는 소리도 상한(mech/misc)을 둔다 */
  const CAT = { casing: 'mech', step: 'misc', whiz: 'misc', hit: 'misc', head: 'misc', kill: 'misc', hurt: 'misc', ping: 'mech', whistle: 'boom' };
  const sfx = (name, ...a) => {
    if (!AC) return; const c = CAT[name];
    if (c) { const now = AC.currentTime, l = voices[c]; for (let i = l.length - 1; i >= 0; i--) if (l[i].end <= now) l.splice(i, 1); if (l.length >= CAPS[c]) { stats.dropped++; return; } l.push({ end: now + .5, g: { gain: { cancelScheduledValues() {}, setTargetAtTime() {} } } }); }
    try { SFX[name](...a); } catch (e) { /* 소리는 게임 진행에 필수가 아니다 */ }
  };
  /** 받아 둔 샘플 파일 수(소리를 켜기 전에도 확인 가능) */
  const fetched = async () => (await Promise.all(Object.values(raw))).filter(Boolean).length;
  return { init, sfx, music, stats, fetched, total: Object.keys(raw).length, get context() { return AC; }, get loaded() { return Object.fromEntries(Object.entries(buffers).map(([k, v]) => [k, v.length])); }, voices };
}
