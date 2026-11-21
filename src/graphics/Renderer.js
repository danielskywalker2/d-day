// Renderer — WebGL 렌더러, 월드/1인칭 장면, 카메라, 후처리.
// 품질 단계 두 가지를 같은 장면에서 바꿔 가며 비교할 수 있다(F8 또는 ?gfx=legacy).
//   legacy : 4단계까지의 화면(블룸 → ACES 근사 → 색보정·비네트·입자)
//   high   : 5단계 — 화면 공간 차폐(SSAO) · 깊이 기반 원거리 대기 · three.js ACESFilmic 톤매핑 · sRGB 출력
//            · 전쟁 영화풍 색보정(블리치 바이패스 + 청록/주황 분리) · 밝기에 따라 달라지는 미세 필름 입자 · 절제된 블룸
// 후처리는 EffectComposer 없이 직접 짠 전체 화면 패스다(three r160 내장 셰이더 조각만 사용 — 추가 파일 없음).
import * as THREE from 'three';

const PVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const pm = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: PVS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
// 깊이 버퍼 → 시야 공간 거리 (원근 카메라)
const DEPTH_FN = `
uniform sampler2D tDepth; uniform float cNear, cFar;
float viewZ(vec2 uv){ float d = texture2D(tDepth, uv).x; return (cNear * cFar) / ((cFar - cNear) * d - cFar); }   // 음수(카메라 앞)
`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    /** 7단계 동적 해상도: 프레임이 느리면 내부 해상도(픽셀 비율)를 단계적으로 낮추고, 여유가 생기면 다시 올린다 */
    this.prMax = Math.min(devicePixelRatio, 2); this.prMin = .7; this.adaptive = true; this._adapt = { ema: 16.7, slowT: 0, fastT: 0, coolT: 0 };
    r.setPixelRatio(this.prMax);
    r.autoClear = false;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    // 장면은 선형 HDR 로 그리고 톤매핑·sRGB 변환은 마지막 패스에서 한 번만 한다
    r.toneMapping = THREE.NoToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    /** 월드 장면과 카메라 */
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 420);
    this.camera.rotation.order = 'YXZ';
    /** 1인칭 총기·손 전용 장면(월드에 파묻히지 않게 깊이를 따로 그린다) */
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    /** 품질 단계 바뀔 때 다른 관리자(조명·환경)가 따라 바꾸도록 알림 */
    this.onQuality = [];
    this.quality = 'high';
    /** 차폐(SSAO) 사용 여부 — 성능 측정·저사양용 */
    this.ao = true;
    /** 프레임 시간 측정(ms, 지수 평균) */
    this.stats = { cpu: 0 };
    this._initPost();
    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize); this.resize();
  }

  _initPost() {
    const depthTexture = new THREE.DepthTexture(4, 4); depthTexture.type = THREE.UnsignedIntType;
    const rtScene = this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthTexture });
    const rtA = this.rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }); this.rtB = rtA.clone();
    // 차폐는 절반 해상도에서 계산하고 흐린 뒤 장면 색에 곱한다
    this.rtAO = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }); this.rtAO2 = this.rtAO.clone();
    this.postScene = new THREE.Scene(); this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.postScene.add(this.quad);
    const cam = this.camera, near = { value: cam.near }, far = { value: cam.far }, tDepth = { value: depthTexture };

    // ---- 블룸 (두 단계 공용, 문턱·세기만 다름)
    this.brightMat = pm('uniform sampler2D tex; uniform float thr; varying vec2 vUv; void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(min(c, vec3(12.)) * smoothstep(thr, thr + .75, l), 1.); }', { tex: { value: rtScene.texture }, thr: { value: .95 } });
    this.blurMat = pm('uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv; void main(){ vec3 c = texture2D(tex, vUv).rgb * .227; c += (texture2D(tex, vUv + dir * 1.4).rgb + texture2D(tex, vUv - dir * 1.4).rgb) * .194; c += (texture2D(tex, vUv + dir * 3.3).rgb + texture2D(tex, vUv - dir * 3.3).rgb) * .121; c += (texture2D(tex, vUv + dir * 5.2).rgb + texture2D(tex, vUv - dir * 5.2).rgb) * .054; c += (texture2D(tex, vUv + dir * 7.1).rgb + texture2D(tex, vUv - dir * 7.1).rgb) * .016; gl_FragColor = vec4(c, 1.); }', { tex: { value: null }, dir: { value: new THREE.Vector2() } });

    // ---- SSAO + 원거리 대기 비율: 월드 깊이만으로 계산해 저해상도 버퍼에 담는다(R = 차폐, G = 대기)
    //      깊이로 법선을 복원하고 화면 공간 나선 표본 12개로 주변 차폐를 잰다
    this.aoMat = pm(`${DEPTH_FN}
      uniform vec2 res; uniform mat4 projInv; uniform float radius, strength, hazeK; varying vec2 vUv;
      vec3 viewPos(vec2 uv){ float z = viewZ(uv); vec4 p = projInv * vec4(uv * 2. - 1., 0., 1.); p.xyz /= p.w; return p.xyz * (z / p.z); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.7); }
      void main(){
        float z = viewZ(vUv);
        if (-z > cFar * .97) { gl_FragColor = vec4(1., 0., 0., 1.); return; }   // 하늘: 차폐·대기 없음
        float haze = hazeK * smoothstep(35., 170., -z);
        if (strength <= 0. || -z < .3) { gl_FragColor = vec4(1., haze, 0., 1.); return; }
        vec3 P = viewPos(vUv);
        vec2 px = 1. / res;
        vec3 dx = viewPos(vUv + vec2(px.x, 0.)) - P, dy = viewPos(vUv + vec2(0., px.y)) - P;
        vec3 dx2 = P - viewPos(vUv - vec2(px.x, 0.)), dy2 = P - viewPos(vUv - vec2(0., px.y));
        if (dot(dx2, dx2) < dot(dx, dx)) dx = dx2; if (dot(dy2, dy2) < dot(dy, dy)) dy = dy2;   // 경계에서 가까운 쪽 이웃
        vec3 N = normalize(cross(dx, dy));
        float rPix = radius * res.y * .5 / (-z * projInv[1][1]);                 // 반경(m) → 절반 해상도 픽셀
        rPix = clamp(rPix, 2., 90.);
        float ang = hash(gl_FragCoord.xy) * 6.2832, occ = 0.;
        for (int i = 0; i < 12; i++) {
          float f = (float(i) + .5) / 12.; float a = ang + float(i) * 2.39996;
          vec2 o = vec2(cos(a), sin(a)) * rPix * f * px;
          vec3 S = viewPos(vUv + o) - P; float d2 = dot(S, S);
          float h = max(dot(N, S) / sqrt(d2 + 1e-4) - .14, 0.);
          occ += h * clamp(1. - d2 / (radius * radius * 4.), 0., 1.);
        }
        float ao = 1. - strength * occ / 12.;
        ao = mix(ao, 1., smoothstep(45., 85., -z));          // 멀리서는 끈다(안개 속)
        gl_FragColor = vec4(clamp(ao, 0., 1.), haze, 0., 1.);
      }`, { tDepth, cNear: near, cFar: far, res: { value: new THREE.Vector2() }, projInv: { value: new THREE.Matrix4() }, radius: { value: .75 }, strength: { value: 2.3 }, hazeK: { value: .42 } });
    // 깊이를 보며 흐리기(경계 번짐 방지)
    this.aoBlurMat = pm(`${DEPTH_FN}
      uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main(){ float z0 = viewZ(vUv), w = 0.; vec2 s = vec2(0.);
        for (int i = -3; i <= 3; i++) { vec2 uv = vUv + dir * float(i) * 1.5; float k = exp(-float(i * i) * .18) * exp(-abs(viewZ(uv) - z0) * 2.5 / max(.5, -z0 * .05)); s += texture2D(tex, uv).rg * k; w += k; }
        gl_FragColor = vec4(s / w, 0., 1.); }`, { tDepth, cNear: near, cFar: far, tex: { value: null }, dir: { value: new THREE.Vector2() } });

    // ---- 최종 합성: 기존(legacy)
    // 폭발 충격(shock 0~1): 방사 흐림 + 색수차 + 채도 빠짐 — 두 단계 공통
    const SHOCK = `vec3 shockSample(sampler2D t, vec2 uv, float k){ vec2 d = uv - .5; vec3 c = vec3(0.);
        for (int i = 0; i < 6; i++) { float f = 1. - float(i) * .012 * k; vec2 u = .5 + d * f; c += vec3(texture2D(t, u - d * k * .02).r, texture2D(t, u).g, texture2D(t, u + d * k * .02).b); }
        return c / 6.; }`;
    this.legacyMat = pm(`uniform sampler2D tex, bloom; uniform float time, exposure, shock; varying vec2 vUv; ${SHOCK}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - .5; float r2 = dot(d, d);
        vec3 c = vec3(texture2D(tex, vUv - d * r2 * .012).r, texture2D(tex, vUv).g, texture2D(tex, vUv + d * r2 * .012).b);
        if (shock > .01) c = mix(c, shockSample(tex, vUv, shock), min(1., shock * 1.5));
        c += texture2D(bloom, vUv).rgb * .55; c *= exposure;
        c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14);
        float l = dot(c, vec3(.299, .587, .114));
        c = mix(vec3(l), c, .8);
        c = mix(c, c * c * (3. - 2. * c), .35);
        c *= mix(vec3(.92, 1., 1.08), vec3(1.03, 1., .96), smoothstep(.05, .75, l));
        c *= 1. - .55 * smoothstep(.12, .62, r2);
        c = pow(max(c, 0.), vec3(1. / 2.2));
        c += (hash(gl_FragCoord.xy + fract(time) * 91.7) - .5) * .035;
        c = mix(c, vec3(dot(c, vec3(.3, .59, .11))), shock * .5);
        gl_FragColor = vec4(c, 1.);
      }`, { tex: { value: rtScene.texture }, bloom: { value: rtA.texture }, time: { value: 0 }, exposure: { value: 1.25 }, shock: this._shockU = { value: 0 } });

    // ---- 최종 합성: 5단계(high)
    this.finalMat = pm(`${DEPTH_FN}
      uniform sampler2D tex, bloom, tAO; uniform float time, bloomK, grainK, sat, bleachK, con, split, hasVM, shock; uniform vec3 hazeCol; varying vec2 vUv;
      ${SHOCK}
      ${THREE.ShaderChunk.tonemapping_pars_fragment}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - .5; float r2 = dot(d, d);
        vec3 c = vec3(texture2D(tex, vUv - d * r2 * .006).r, texture2D(tex, vUv).g, texture2D(tex, vUv + d * r2 * .006).b);
        if (shock > .01) c = mix(c, shockSample(tex, vUv, shock), min(1., shock * 1.5));
        // 차폐 + 원거리 대기(먼 곳만 색을 빼고 회청색으로 띄움). 총기 화소는 제외 — 총기를 그린 뒤 깊이가 1 보다 작은 곳이 총기
        vec2 ah = texture2D(tAO, vUv).rg;
        float gun = hasVM * (1. - step(.99999, texture2D(tDepth, vUv).x));
        ah = mix(ah, vec2(1., 0.), gun);
        c *= ah.x;
        c = mix(c, hazeCol * (.9 + .1 * dot(c, vec3(.33))), ah.y);
        c += texture2D(bloom, vUv).rgb * bloomK;
        c = ACESFilmicToneMapping(c);
        // 전쟁 영화풍: 블리치 바이패스(채도 빼고 대비 올림) + 그림자 청록 · 밝은 곳 따뜻하게
        float l = dot(c, vec3(.2126, .7152, .0722));
        vec3 bleach = mix(vec3(l), c, sat);
        vec3 over = mix(2. * bleach * l, 1. - 2. * (1. - bleach) * (1. - l), step(.5, l));
        c = mix(bleach, over, bleachK);
        c = mix(c, c * c * (3. - 2. * c), con);                                   // S 곡선
        c *= mix(vec3(1. - .1 * split, 1., 1. + .07 * split), vec3(1. + .05 * split, 1., 1. - .07 * split), smoothstep(.08, .7, l));
        c = max(c - .012, 0.) * 1.012;                                            // 검은 점을 살짝 눌러 깊이감
        c *= 1. - .38 * smoothstep(.16, .7, r2);                                  // 약한 비네트
        c = mix(c, vec3(l), shock * .5);
        c = sRGBTransferOETF(vec4(c, 1.)).rgb;
        // 필름 입자: 중간 밝기에서 가장 보이고 아주 밝거나 어두운 곳은 약하게, 매 프레임 바뀜
        float g = hash(gl_FragCoord.xy * .73 + fract(time * 7.3) * 113.1) + hash(gl_FragCoord.xy * 1.31 - fract(time * 3.1) * 71.7) - 1.;
        c += g * grainK * (1. - abs(l * 2. - 1.) * .6);
        gl_FragColor = vec4(c, 1.);
      }`, { tDepth, cNear: near, cFar: far, tex: { value: rtScene.texture }, bloom: { value: rtA.texture }, time: { value: 0 }, tAO: { value: this.rtAO.texture }, hasVM: { value: 1 }, shock: this._shockU, bloomK: { value: .32 }, grainK: { value: .022 }, hazeCol: { value: new THREE.Color(.62, .66, .7) }, toneMappingExposure: { value: 1.6 }, sat: { value: .8 }, bleachK: { value: .22 }, con: { value: .35 }, split: { value: 1 } });
    this._near = near; this._far = far;
  }

  /**
   * 실제 프레임 간격(ms)을 받아 화면 주사율을 지키도록 픽셀 비율을 조정한다.
   * 화면 주사율(vsync, 가장 짧은 프레임 간격으로 추정: 120Hz 8.3ms · 60Hz 16.7ms · 저전력 30fps 33.3ms)을 기준으로
   *  - 1초 넘게 평균이 주사율보다 확실히 느리면(18ms 와 주사율×1.35 중 큰 값) 0.15 내린다
   *  - 3초 넘게 주사율에 붙어 있으면(12.5ms 와 주사율×1.2 중 큰 값) 0.1 올린다 — 60Hz 화면(아이패드 등)에서도 원래 해상도로 돌아온다
   *  - 낮춘 뒤 2.5초마다 확인해 프레임이 10% 넘게 빨라지지 않으면 한 단계 더(최대 4단계) 내려 보고, 그래도 그대로면 해상도 탓이 아니므로(CPU·브라우저 제한) 되돌리고 한동안(30초부터 두 배씩, 최대 4분) 낮추지 않는다
   *  - 느려서 내렸던 단계로 다시 올릴 때는 12초를 기다려 오르내림을 반복하지 않는다. 바꾼 뒤 2초는 그대로 둔다
   */
  adapt(frameMs) {
    const a = this._adapt; if (!this.adaptive || !(frameMs > 0) || frameMs > 100) return;
    if (a.vsync === undefined) { a.vsync = frameMs; a.failPr = 99; }
    // 주사율 추정 = 가장 짧은 프레임 간격을 따라가고 아주 천천히(약 20초) 풀린다. 처음부터 30fps 로 묶인 기기(저전력 모드)는 33ms 로 잡힌다.
    // 60Hz 기기가 GPU 가 느려 30fps 로 떨어진 것과 도중에 30fps 로 묶인 것은 간격만으로 구분이 안 되므로, 아래의 '낮춰 보고 빨라졌는지' 확인으로 가른다
    const dt = frameMs / 1000;
    a.vsync = frameMs < a.vsync ? Math.max(4, frameMs) : a.vsync + (frameMs - a.vsync) * .0015;
    a.ema += (frameMs - a.ema) * .08; a.coolT -= dt;
    const slowMs = Math.max(18, a.vsync * 1.35), fastMs = Math.max(12.5, a.vsync * 1.2);   // 60Hz 의 흔들림(15~18ms)은 '빠름'으로 본다
    if (a.ema > slowMs) { a.slowT += dt; a.fastT = 0; } else if (a.ema < fastMs) { a.fastT += dt; a.slowT = 0; } else { a.slowT = a.fastT = 0; }
    const pr = this.gl.getPixelRatio(); let next = pr;
    a.noGainT = (a.noGainT || 0) - dt;
    // 낮춘 뒤 2.5초: 프레임이 10% 넘게 빨라지지 않았으면 해상도 탓이 아니다(CPU·브라우저 제한 등) → 되돌리고 한동안(30초부터 두 배씩, 최대 4분) 낮추지 않는다
    // 주사율에 맞춰 프레임이 끊어지므로(60Hz 면 16.7·33.3ms) 한 단계로는 빨라지지 않을 수 있어 최대 4단계(약 70%)까지 내려 본다
    if (a.probe && (a.probe.t += dt) > 2.5) {
      if (a.ema < a.probe.ema * .9) a.probe = null;                                                                 // 빨라졌다 → 유지
      else if (a.probe.steps < 4 && pr > this.prMin) { next = Math.max(this.prMin, pr - .15); a.probe.steps++; a.probe.t = 0; }
      else { next = a.probe.from; a.block = Math.min(240, (a.block || 15) * 2); a.noGainT = a.block; a.failPr = 99; a.probe = null; }   // 30·60·120·240초                                // 소용없다 → 되돌림
    } else if (a.coolT <= 0 && a.slowT > 1 && pr > this.prMin && a.noGainT <= 0 && !a.probe) { next = Math.max(this.prMin, pr - .15); a.failPr = pr; a.probe = { from: pr, ema: a.ema, t: 0, steps: 1 }; }
    else if (a.coolT <= 0 && a.fastT > (pr + .1 >= a.failPr - 1e-3 ? 12 : 3) && pr < this.prMax) next = Math.min(this.prMax, pr + .1);
    if (next !== pr) { this.gl.setPixelRatio(next); this.resize(); a.coolT = 2; a.slowT = a.fastT = 0; if (next >= a.failPr - 1e-3) a.failPr = 99; }
  }
  get pixelRatio() { return this.gl.getPixelRatio(); }

  /** 가까운 폭발의 화면 충격(0~1). 약 1초에 걸쳐 풀린다 */
  shockPulse(k) { this.shock = Math.max(this.shock || 0, Math.min(1, k)); }

  /** 'high' | 'legacy' — 후처리와 다른 관리자의 품질 설정을 함께 바꾼다. */
  setQuality(q) {
    this.quality = q === 'legacy' ? 'legacy' : 'high';
    this.brightMat.uniforms.thr.value = this.quality === 'high' ? 1.25 : .95;
    for (const fn of this.onQuality) fn(this.quality);
    return this.quality;
  }

  resize() {
    const w = innerWidth, h = innerHeight, r = this.gl;
    r.setSize(w, h, false);
    const pr = r.getPixelRatio(), W = Math.max(4, w * pr | 0), H = Math.max(4, h * pr | 0);
    this.rtScene.setSize(W, H); this.rtA.setSize(W >> 2 || 1, H >> 2 || 1); this.rtB.setSize(W >> 2 || 1, H >> 2 || 1);
    // 차폐 해상도: 화면 픽셀 기준 절반(고해상도 화면에서는 버퍼의 1/4) — 흐린 뒤 곱하므로 차이가 거의 안 보인다
    const sh = pr > 1.5 ? 2 : 1, aw = Math.max(1, W >> sh), ah = Math.max(1, H >> sh);
    this.rtAO.setSize(aw, ah); this.rtAO2.setSize(aw, ah); this.aoMat.uniforms.res.value.set(aw, ah);
    this.camera.aspect = this.vmCam.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCam.updateProjectionMatrix();
  }
  /** 시야각을 부드럽게 목표값으로 옮긴다. */
  setFov(target, dt) { const c = this.camera; if (Math.abs(c.fov - target) > .01) { c.fov += (target - c.fov) * Math.min(1, dt * 14); c.updateProjectionMatrix(); } }
  _pass(mat, target) { this.quad.material = mat; this.gl.setRenderTarget(target); this.gl.render(this.postScene, this.postCam); }

  /** 한 프레임 그리기. viewModel=false 면 1인칭 총기를 그리지 않는다(메뉴·사망). */
  render(time, { viewModel = true } = {}) {
    const t0 = performance.now(), r = this.gl, high = this.quality === 'high';
    { const dt = Math.min(.1, Math.max(0, time - (this._lastT ?? time))); this._lastT = time; this.shock = (this.shock || 0) * Math.exp(-dt * 2.6); this._shockU.value = this.shock < .01 ? 0 : this.shock; }
    r.setRenderTarget(this.rtScene); r.clear(); r.render(this.scene, this.camera);
    if (high) {   // 차폐·대기: 총기를 그리기 전의 월드 깊이로 저해상도 계산 → 흐림. 장면 색에는 마지막 패스에서 곱한다
      const cam = this.camera; this._near.value = cam.near; this._far.value = cam.far;
      const a = this.aoMat.uniforms; a.projInv.value.copy(cam.projectionMatrixInverse); a.strength.value = this.ao ? 2.3 : 0;
      this._pass(this.aoMat, this.rtAO);
      const b = this.aoBlurMat; b.uniforms.tex.value = this.rtAO.texture; b.uniforms.dir.value.set(1 / this.rtAO.width, 0); this._pass(b, this.rtAO2);
      b.uniforms.tex.value = this.rtAO2.texture; b.uniforms.dir.value.set(0, 1 / this.rtAO.height); this._pass(b, this.rtAO);
    }
    if (viewModel) { r.setRenderTarget(this.rtScene); r.clearDepth(); r.render(this.vmScene, this.vmCam); }
    this.finalMat.uniforms.hasVM.value = viewModel ? 1 : 0;
    const { rtA, rtB, blurMat } = this;
    this._pass(this.brightMat, rtA);
    blurMat.uniforms.tex.value = rtA.texture; blurMat.uniforms.dir.value.set(1 / rtA.width, 0); this._pass(blurMat, rtB);
    blurMat.uniforms.tex.value = rtB.texture; blurMat.uniforms.dir.value.set(0, 1 / rtA.height); this._pass(blurMat, rtA);
    const fm = high ? this.finalMat : this.legacyMat; fm.uniforms.time.value = time; this._pass(fm, null);
    this.stats.cpu += (performance.now() - t0 - this.stats.cpu) * .05;
  }
}
