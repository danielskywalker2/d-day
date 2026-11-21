// CampaignManager — 캠페인 진행(해금·완료 기록)을 브라우저 localStorage 에 저장한다.
// 저장이 막힌 환경(사생활 보호 창 등)에서도 예외 없이 동작하고, 그때는 이번 접속 동안만 기억한다.
import { STAGES } from './stages.js';

const KEY = 'dday-campaign-v1';

export class CampaignManager {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.data = this._load();
  }
  _load() {
    const empty = { unlocked: 1, completed: {}, version: 1 };
    try { const raw = this.storage.getItem(KEY); if (!raw) return empty; const d = JSON.parse(raw); return { ...empty, ...d, completed: d.completed || {} }; } catch (e) { return empty; }
  }
  _save() { try { this.storage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; } }

  get stages() { return STAGES; }
  isUnlocked(id) { return id <= this.data.unlocked; }
  isCompleted(id) { return !!this.data.completed[id]; }
  record(id) { return this.data.completed[id] || null; }
  /** 이어서 할 스테이지: 해금된 것 중 아직 안 깬 첫 스테이지(모두 깼으면 마지막) */
  get current() { for (const s of STAGES) if (this.isUnlocked(s.id) && !this.isCompleted(s.id)) return s.id; return this.data.unlocked; }
  get allComplete() { return STAGES.every((s) => this.isCompleted(s.id)); }

  /** 스테이지 완료: 기록(더 좋은 기록만 갱신은 하지 않고 최근 기록 + 완료 횟수)을 남기고 다음 스테이지를 해금한다 */
  complete(id, stats = {}) {
    const prev = this.data.completed[id];
    this.data.completed[id] = { ...stats, clears: (prev ? prev.clears || 1 : 0) + 1, at: new Date().toISOString() };
    if (id < STAGES.length) this.data.unlocked = Math.max(this.data.unlocked, id + 1);
    this._save();
    return { unlockedNext: id < STAGES.length ? id + 1 : null, campaignComplete: this.allComplete };
  }
  reset() { this.data = { unlocked: 1, completed: {}, version: 1 }; this._save(); }
  /** 개발·테스트용: 모든 스테이지 해금 */
  unlockAll() { this.data.unlocked = STAGES.length; this._save(); }
}

function safeStorage() {
  try { const k = '__dday_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) {
    const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
}

/**
 * 스테이지 목표 진행기. defs = [{ text, done(ctx) → bool, progress?(ctx) → string, target?(ctx) → {x,z}|null }]
 * 목표는 순서대로 켜진다. 앞 목표가 끝나야 다음 목표의 조건을 본다(이미 만족한 조건이면 켜지자마자 끝난다).
 */
export class ObjectiveTracker {
  constructor(defs, { onAdvance, onComplete } = {}) { Object.assign(this, { defs, onAdvance, onComplete }); this.index = 0; this.doneAt = []; this.finished = false; }
  get current() { return this.defs[this.index] || null; }
  update(ctx, time) {
    if (this.finished) return;
    let guard = 0;
    while (this.current && this.current.done(ctx) && guard++ < this.defs.length) {
      this.doneAt[this.index] = time; this.index++;
      if (this.index >= this.defs.length) { this.finished = true; this.onComplete && this.onComplete(); return; }
      this.onAdvance && this.onAdvance(this.index, this.current);
    }
  }
  /** HUD 용: [{ text, state: 'done'|'active'|'pending', progress }] */
  list(ctx) { return this.defs.map((d, i) => ({ text: d.text, state: i < this.index ? 'done' : i === this.index && !this.finished ? 'active' : this.finished ? 'done' : 'pending', progress: i === this.index && d.progress ? d.progress(ctx) : '' })); }
}
