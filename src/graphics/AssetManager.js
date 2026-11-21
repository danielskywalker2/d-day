// AssetManager — 파일 에셋(GLB/GLTF 모델, 텍스처, HDR 하늘) 로딩을 한곳에서 관리한다.
//
//  · 로딩 진행률 ............ onProgress(fn), progress, whenReady()
//  · 실패 처리 .............. 실패해도 예외를 던지지 않는다. 게임은 절차적 모델/임시 모델로 계속 실행된다.
//  · 텍스처 누락 감지 ........ GLB 안의 텍스처가 안 불러와지면 체커 무늬로 바꾸고 report() 에 기록한다.
//  · 캐싱·중복 로딩 방지 ...... 같은 URL 은 한 번만 내려받고, 진행 중인 요청도 공유한다.
//  · 복제·재사용 ............ instantiate(key) 가 원본을 복제(스킨 메시는 SkeletonUtils.clone)해서 돌려준다.
//
// 모델 슬롯은 assets/models/manifest.json 에서 키 → 파일로 연결한다. 형식은 docs/ASSETS.md 참고.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from '../../vendor/jsm/loaders/RGBELoader.js';
import { clone as cloneSkinned } from '../../vendor/jsm/utils/SkeletonUtils.js';

const LOG = '[AssetManager]';

export class AssetManager {
  constructor({ anisotropy = 8 } = {}) {
    this.anisotropy = anisotropy;
    /** url → { url, status: 'loading'|'loaded'|'failed', promise, gltf, error, missingTextures: string[], bytes } */
    this.models = new Map();
    /** 슬롯 키 → { key, spec, url, entry } */
    this.slots = new Map();
    /** url → { base: Texture, status, promise } */
    this.textures = new Map();
    this.failedTextures = [];
    this.warnings = [];
    this.manifest = null;
    this.total = 0;
    this.done = 0;
    this._pending = new Set();
    this._listeners = new Set();
    this._templates = new Map();   // 슬롯 키 → 정규화된 템플릿 Object3D
    this._templateHooks = [];      // 새 템플릿 재질에 적용할 콜백 (예: 환경광 세기)
    this._checker = null;
    this._placeholderMat = null;
    this.textureLoader = new THREE.TextureLoader();
  }

  // ------------------------------------------------------------- 진행률
  /** fn(progress 0..1, done, total) — 로딩 항목이 끝날 때마다 호출된다. 해제 함수를 돌려준다. */
  onProgress(fn) { this._listeners.add(fn); fn(this.progress, this.done, this.total); return () => this._listeners.delete(fn); }
  get progress() { return this.total ? this.done / this.total : 1; }
  _emit() { for (const fn of this._listeners) { try { fn(this.progress, this.done, this.total); } catch (e) { console.error(LOG, e); } } }
  _track(promise) {
    this.total++; this._emit();
    const settled = promise.then(() => {}, () => {}).finally(() => { this.done++; this._pending.delete(settled); this._emit(); });
    this._pending.add(settled);
    return promise;
  }
  /** 지금까지 요청된 모든 로딩이 (성공이든 실패든) 끝나면 resolve. 절대 reject 하지 않는다. */
  async whenReady() { while (this._pending.size) await Promise.all([...this._pending]); return this.report(); }

  // ------------------------------------------------------------- 텍스처
  /**
   * 이미지 텍스처. 같은 URL 은 한 번만 내려받고, 반복·회전 설정이 다른 요청은 이미지를 공유하는 복제본을 받는다.
   * 실패하면 색상 텍스처는 체커 무늬, 노멀은 평평한 값, 그 밖의 데이터 맵은 흰색으로 대체한다.
   */
  texture(url, { srgb = false, repeat = [1, 1], rotation = 0, kind = srgb ? 'color' : 'data' } = {}) {
    let rec = this.textures.get(url);
    if (!rec) {
      const base = new THREE.Texture();
      rec = { base, status: 'loading', kind };
      rec.promise = this._track(new Promise((resolve, reject) => {
        this.textureLoader.load(url, (tex) => { base.image = tex.image; base.needsUpdate = true; rec.status = 'loaded'; resolve(base); },
          undefined, () => {
            rec.status = 'failed'; this.failedTextures.push(url);
            console.warn(LOG, '텍스처 로드 실패 → 대체 텍스처 사용:', url);
            base.image = this._fallbackImage(kind); base.needsUpdate = true; reject(new Error('texture failed: ' + url));
          });
      }));
      rec.promise.catch(() => {});
      this.textures.set(url, rec);
    }
    // 이미지(Source)는 공유하고 설정만 다른 텍스처. clone() 은 이미지가 오기 전에 업로드 플래그를 세워 경고를 내므로 쓰지 않는다.
    const t = new THREE.Texture(); t.source = rec.base.source;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.rotation = rotation; t.anisotropy = this.anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (rec.status !== 'loading') t.needsUpdate = true;
    else rec.promise.then(() => { t.needsUpdate = true; }, () => { t.needsUpdate = true; });
    return t;
  }
  /** Poly Haven 형식 PBR 세트(./assets/{name}_diff|nor|arm.jpg) → MeshStandardMaterial 에 펼쳐 넣을 맵 묶음. */
  pbr(name, rx = 1, ry = rx, rot = 0) {
    const o = { repeat: [rx, ry], rotation: rot };
    const arm = this.texture(`./assets/${name}_arm.jpg`, { ...o, kind: 'arm' });
    return { map: this.texture(`./assets/${name}_diff.jpg`, { ...o, srgb: true }), normalMap: this.texture(`./assets/${name}_nor.jpg`, { ...o, kind: 'normal' }), roughnessMap: arm, aoMap: arm };
  }
  /** HDR 환경맵. 실패하면 reject — 호출 측이 절차적 하늘을 유지한다. */
  hdr(url) {
    return this._track(new Promise((resolve, reject) => {
      new RGBELoader().setDataType(THREE.FloatType).load(url, resolve, undefined, (e) => {
        this.failedTextures.push(url); console.warn(LOG, 'HDR 로드 실패 → 절차적 하늘 유지:', url); reject(e || new Error('hdr failed'));
      });
    }));
  }
  _fallbackImage(kind) {
    const c = document.createElement('canvas'); c.width = c.height = kind === 'color' ? 64 : 4; const g = c.getContext('2d');
    if (kind === 'color') { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#ff00ff' : '#111'; g.fillRect(x * 8, y * 8, 8, 8); } }
    else { g.fillStyle = kind === 'normal' ? 'rgb(128,128,255)' : '#fff'; g.fillRect(0, 0, 4, 4); }
    return c;
  }
  /** 누락 텍스처 표시용 자홍/검정 체커. */
  get checkerTexture() {
    if (!this._checker) { this._checker = new THREE.CanvasTexture(this._fallbackImage('color')); this._checker.colorSpace = THREE.SRGBColorSpace; this._checker.wrapS = this._checker.wrapT = THREE.RepeatWrapping; this._checker.magFilter = THREE.NearestFilter; }
    return this._checker;
  }

  // ------------------------------------------------------------- 모델
  /**
   * GLB/GLTF 파일을 불러온다. 같은 URL 은 캐시된 결과(또는 진행 중인 요청)를 공유한다.
   * @returns {Promise<object|null>} 성공하면 gltf, 실패하면 null (reject 하지 않음)
   */
  loadModel(url) {
    const hit = this.models.get(url);
    if (hit) return hit.promise;
    const entry = { url, status: 'loading', gltf: null, error: null, missingTextures: [], bytes: 0 };
    // 모델마다 별도 LoadingManager 를 써서, 이 모델이 참조한 텍스처 중 실패한 것만 정확히 모은다.
    const mgr = new THREE.LoadingManager();
    mgr.onError = (u) => { if (u !== url) entry.missingTextures.push(u); };
    const loader = new GLTFLoader(mgr);
    entry.promise = this._track(new Promise((resolve) => {
      loader.load(url, (gltf) => {
        try { this._inspect(entry, gltf); entry.gltf = gltf; entry.status = 'loaded'; }
        catch (e) { entry.status = 'failed'; entry.error = e; console.error(LOG, '모델 처리 실패:', url, e); }
        resolve(entry.gltf);
      }, (ev) => { if (ev && ev.loaded) entry.bytes = ev.loaded; }, (err) => {
        entry.status = 'failed'; entry.error = err;
        console.warn(LOG, '모델 로드 실패 → 대체 모델 사용:', url, err && (err.message || err));
        resolve(null);
      });
    }));
    this.models.set(url, entry);
    return entry.promise;
  }
  /** 불러온 GLTF 를 점검: 그림자 기본값, 누락 텍스처를 체커로 표시. */
  _inspect(entry, gltf) {
    const json = gltf.parser && gltf.parser.json, assoc = gltf.parser && gltf.parser.associations;
    const SLOTS = [['baseColorTexture', 'map', true], ['metallicRoughnessTexture', 'roughnessMap'], ['normalTexture', 'normalMap'], ['occlusionTexture', 'aoMap'], ['emissiveTexture', 'emissiveMap']];
    const seen = new Set();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mat || seen.has(mat)) continue; seen.add(mat);
        const idx = assoc && assoc.get(mat) && assoc.get(mat).materials, def = json && json.materials && json.materials[idx];
        if (!def) continue;
        for (const [gltfKey, prop, isColor] of SLOTS) {
          const declared = gltfKey === 'baseColorTexture' || gltfKey === 'metallicRoughnessTexture' ? def.pbrMetallicRoughness && def.pbrMetallicRoughness[gltfKey] : def[gltfKey];
          if (declared && !mat[prop]) {
            const msg = `${entry.url}: 재질 "${def.name || idx}" 의 ${gltfKey} 누락`;
            this.warnings.push(msg); console.warn(LOG, '텍스처 누락 감지 —', msg);
            if (isColor) { mat.map = this.checkerTexture; mat.needsUpdate = true; }
          }
        }
      }
    });
    if (entry.missingTextures.length) console.warn(LOG, '불러오지 못한 텍스처 파일:', entry.missingTextures);
  }

  // ------------------------------------------------------------- 매니페스트 / 슬롯
  /**
   * 매니페스트(JSON)를 읽고 연결된 모델을 모두 미리 불러온다. 파일이 없거나 깨져도 예외 없이 빈 매니페스트로 진행한다.
   * 각 슬롯 값: null(절차적 모델 사용) 또는 { url, ...배치 옵션 } — docs/ASSETS.md 참고.
   */
  async loadManifest(url, { stage = null } = {}) {
    let data = null;
    try {
      const res = await this._track(fetch(url, { cache: 'no-store' }));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) { console.warn(LOG, '매니페스트를 읽지 못함 → 모든 슬롯을 절차적 모델로 진행:', url, e.message || e); data = { models: {} }; }
    this.manifest = { url, ...data };
    const base = new URL(url, location.href);
    const loads = [];
    for (const [key, raw] of Object.entries((data && data.models) || {})) {
      if (key.startsWith('$') || !raw) continue;
      const spec = typeof raw === 'string' ? { url: raw } : raw;
      if (!spec.url) continue;
      if (stage != null && Array.isArray(spec.stages) && !spec.stages.includes(stage)) { (this._skipped || (this._skipped = new Set())).add(key); continue; }   // 이 스테이지에서 쓰지 않는 모델은 받지 않는다
      const full = new URL(spec.url, base).href;
      const slot = { key, spec, url: full, entry: null };
      this.slots.set(key, slot);
      loads.push(this.loadModel(full).then(() => { slot.entry = this.models.get(full); }));
    }
    await Promise.all(loads);
    return this.report();
  }
  /** 슬롯에 정상적으로 불러온 모델이 있으면 true. */
  has(key) { const s = this.slots.get(key); return !!(s && s.entry && s.entry.status === 'loaded'); }
  spec(key) { const s = this.slots.get(key); return s ? s.spec : null; }
  /** 새 템플릿의 재질에 적용할 콜백 등록(이미 만든 템플릿에도 즉시 적용). */
  onTemplateMaterial(fn) { this._templateHooks.push(fn); for (const t of this._templates.values()) this._eachMaterial(t, fn); }
  _eachMaterial(root, fn) { const seen = new Set(); root.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !seen.has(m)) { seen.add(m); fn(m); } }); }

  /**
   * 슬롯 모델의 복제본을 만든다. 없으면 null — 호출 측이 절차적 모델로 대체한다.
   * @param {string} key 매니페스트 슬롯 키 (예: 'props.crate')
   * @param {{fit?: number[], fitMode?: 'contain'|'stretch', anchor?: 'bottom'|'center'|'origin'}} [opts]
   *   fit: 이 크기 [w,h,d] 상자에 맞춘다 · anchor: 기준점(bottom=바닥 중앙, center=중심, origin=파일 원점 유지). 매니페스트 값이 우선
   */
  instantiate(key, opts = {}) {
    if (!this.has(key)) { if (this._skipped && this._skipped.has(key)) console.warn(LOG, `'${key}' 는 이 스테이지 목록(manifest stages)에 없어 불러오지 않았음 → 절차적 모델/생략`); return null; }
    const tpl = this._template(key, opts.anchor);
    const hasSkin = tpl.userData.hasSkin;
    const inner = hasSkin ? cloneSkinned(tpl.children[0]) : tpl.children[0].clone(true);
    const root = new THREE.Group(); root.name = key; root.add(inner);
    const spec = this.spec(key) || {}, fit = spec.fit || opts.fit, size = tpl.userData.size;
    if (fit && !spec.scale) {
      const mode = spec.fitMode || opts.fitMode || 'contain';
      const sx = fit[0] / size.x, sy = fit[1] / size.y, sz = fit[2] / size.z;
      if (mode === 'stretch') root.scale.set(sx, sy, sz); else root.scale.setScalar(Math.min(sx, sy, sz));
    }
    root.userData.slot = key; root.userData.animations = this.slots.get(key).entry.gltf.animations || [];
    return root;
  }
  /** 슬롯 원본을 한 번만 정규화(회전·크기·기준점)해서 캐시한다. */
  _template(key, defaultAnchor = 'bottom') {
    let tpl = this._templates.get(key);
    if (tpl) return tpl;
    const { spec, entry } = this.slots.get(key), src = entry.gltf.scene;
    const inner = new THREE.Group(); inner.add(src);
    if (spec.rotation) src.rotation.set(...spec.rotation.map((d) => THREE.MathUtils.degToRad(d)));
    if (spec.scale) src.scale.setScalar(spec.scale);
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const anchor = spec.anchor || defaultAnchor;
    if (anchor !== 'origin') src.position.sub(new THREE.Vector3(c.x, anchor === 'bottom' ? box.min.y : c.y, c.z));
    if (spec.offset) src.position.add(new THREE.Vector3(...spec.offset));
    tpl = new THREE.Group(); tpl.add(inner);
    let hasSkin = false; src.traverse((o) => { if (o.isSkinnedMesh) hasSkin = true; });
    tpl.userData = { size: new THREE.Vector3(Math.max(size.x, 1e-4), Math.max(size.y, 1e-4), Math.max(size.z, 1e-4)), hasSkin };
    for (const fn of this._templateHooks) this._eachMaterial(tpl, fn);
    this._templates.set(key, tpl);
    return tpl;
  }

  /**
   * 모델이 꼭 필요한데 없을 때 쓰는 눈에 띄는 임시 모델(주황·검정 줄무늬 상자 + 윤곽선).
   * 이 게임의 슬롯들은 대부분 절차적 모델로 대체되므로, 대체할 것이 없는 경우에만 쓴다.
   */
  placeholder(w = 1, h = 1, d = 1) {
    if (!this._placeholderMat) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ff7a00';
      for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this._placeholderMat = new THREE.MeshBasicMaterial({ map: t });
    }
    const geo = new THREE.BoxGeometry(w, h, d), m = new THREE.Mesh(geo, this._placeholderMat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xff7a00 })));
    m.userData.placeholder = true; m.castShadow = true;
    return m;
  }

  // ------------------------------------------------------------- 보고
  report() {
    const models = [...this.models.values()].map((e) => ({ url: e.url, status: e.status, error: e.error ? String(e.error.message || e.error) : null, missingTextures: e.missingTextures.slice(), bytes: e.bytes }));
    const slots = {}; for (const [k, s] of this.slots) slots[k] = s.entry ? s.entry.status : 'loading';
    return {
      manifest: this.manifest && this.manifest.url, progress: this.progress, done: this.done, total: this.total,
      models, slots, failedTextures: this.failedTextures.slice(), warnings: this.warnings.slice(),
      failures: models.filter((m) => m.status === 'failed').length + this.failedTextures.length,
    };
  }
}
