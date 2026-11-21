// PropBuilder — 무료 3D 모델이 없는 해변 구조물을 실제 형태에 가깝게 코드로 만든다.
// 상자·원통을 겹치는 대신 단면을 돌출(Extrude)·회전(Lathe)·관(Tube)으로 만들고 모서리를 깎는다.
//   체코 고슴도치(L형강 3개 + 덧판·리벳) · 철조망(원형 코일 + 말뚝 + 직선 가닥) · 방파제(파도막이 곡면 단면)
//   MG42 벙커(경사 지붕·차양·단 진 총안구·흙 둔덕) · MG42 · 파괴된 셔먼 전차 · 히긴스 상륙정(LCVP) · 참호 판자벽
// 모든 함수는 그래픽만 만든다. 충돌·사격 판정은 EnvironmentManager 가 기존 상자를 그대로 쓴다.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const V = THREE.Vector3, PI = Math.PI;
/** 모서리가 둥근 직육면체(돌출 + 베벨). 텍스처 밀도는 실제 크기 기준(tile m 당 1회) */
export function roundedBox(w, h, d, r = .04, tile = 2) {
  const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * .6, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2); boxUV(g, tile); return g;
}
/** 세계 좌표 기반 상자 투영 UV (돌출 형상에 텍스처를 고르게 입힌다) */
export function boxUV(g, tile = 2) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
const prep = (g) => { if (g.index) g = g.toNonIndexed(); g.deleteAttribute('uv2'); if (!g.attributes.uv) boxUV(g); return g; };
const merged = (list) => mergeGeometries(list.map((g) => { let x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }), false);

// ------------------------------------------------------------------ 체코 고슴도치
/** L형강 3개를 서로 엇갈려 리벳 덧판으로 묶은 대전차 장애물. 원점 = 중심, 높이 약 1.5m */
export function hedgehogGeometry() {
  const L = new THREE.Shape(), a = .1, t = .012;   // 10cm × 10cm, 두께 1.2cm 앵글
  L.moveTo(0, 0); L.lineTo(a, 0); L.lineTo(a, t); L.lineTo(t, t); L.lineTo(t, a); L.lineTo(0, a); L.closePath();
  const parts = [];
  const dirs = [[1, 1, .9], [-1, 1, .7], [.1, 1, -1.2]];
  dirs.forEach((d, k) => {
    const g = new THREE.ExtrudeGeometry(L, { depth: 2.2, bevelEnabled: false }); g.translate(-a / 2, -a / 2, -1.1);
    g.rotateZ(k * 2.1);   // 앵글 방향을 조금씩 다르게
    const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), new V(...d).normalize()); g.applyQuaternion(q);
    // 양 끝을 비스듬히 자른 듯 보이도록 끝에 작은 판
    parts.push(boxUV(g, .5));
  });
  // 가운데 덧판과 리벳
  for (let k = 0; k < 3; k++) { const p = new THREE.BoxGeometry(.24, .2, .012); p.rotateY(k * 2.1); p.translate(0, 0, 0); parts.push(boxUV(p, .5)); }
  for (let k = 0; k < 10; k++) { const r = new THREE.SphereGeometry(.013, 6, 4); const a2 = k / 10 * PI * 2; r.translate(Math.cos(a2) * .08, Math.sin(a2) * .07, (k % 2 ? 1 : -1) * .012); r.rotateY((k % 3) * 2.1); parts.push(boxUV(r, .5)); }
  return merged(parts);
}

// ------------------------------------------------------------------ 철조망 (콘서티나 코일)
class Helix extends THREE.Curve {
  constructor(a, b, r, turns) { super(); this.a = a; this.b = b; this.r = r; this.turns = turns; const d = b.clone().sub(a); this.len = d.length(); this.dir = d.normalize(); this.side = new V().crossVectors(this.dir, new V(0, 1, 0)).normalize(); this.up = new V().crossVectors(this.side, this.dir); }
  getPoint(t, out = new V()) {
    const ang = t * this.turns * PI * 2, wob = 1 + Math.sin(t * 37.1) * .08 + Math.sin(t * 91.7) * .05;   // 코일이 조금씩 찌그러짐
    return out.copy(this.a).addScaledVector(this.dir, t * this.len).addScaledVector(this.side, Math.cos(ang) * this.r * wob).addScaledVector(this.up, (Math.sin(ang) + 1) * this.r * .92 * wob);
  }
}
/** a→b 를 따라 놓인 철조망 코일 + 나무 말뚝 + 위아래 직선 가닥(지면 높이 함수 groundAt 사용) */
export function barbedWire(a, b, groundAt) {
  const wire = [], posts = [];
  const len = a.distanceTo(b), segs = Math.max(1, Math.round(len / 4));
  for (let s = 0; s < segs; s++) {
    const p0 = a.clone().lerp(b, s / segs), p1 = a.clone().lerp(b, (s + 1) / segs);
    p0.y = groundAt(p0.x, p0.z) - .05; p1.y = groundAt(p1.x, p1.z) - .05;
    const turns = Math.round(p0.distanceTo(p1) / .2);
    wire.push(new THREE.TubeGeometry(new Helix(p0, p1, .38, turns), turns * 10, .006, 3, false));
    // 가시: 코일 위를 따라 작은 십자
    const h = new Helix(p0, p1, .38, turns);
    for (let i = 0; i < turns * 2; i++) { const p = h.getPoint(i / (turns * 2)); const bb = new THREE.BoxGeometry(.05, .006, .006); bb.rotateY(i * 1.3); bb.rotateZ(.7); bb.translate(p.x, p.y, p.z); wire.push(bb); }
  }
  for (let s = 0; s <= segs; s++) { // 말뚝(나무) — 코일 양쪽
    const p = a.clone().lerp(b, s / segs);
    for (const off of [-.45, .45]) {
      const dir = b.clone().sub(a).normalize(), side = new V(-dir.z, 0, dir.x);
      const q = p.clone().addScaledVector(side, off), y = groundAt(q.x, q.z);
      const g = new THREE.CylinderGeometry(.03, .04, 1.1, 6); g.rotateZ((Math.sin(s * 3.1 + off) * .12)); g.translate(q.x, y + .5, q.z); posts.push(g);
    }
  }
  // 말뚝 사이 위·아래 직선 가닥
  for (const off of [-.45, .45]) for (const hgt of [.25, .85]) {
    const pts = []; for (let s = 0; s <= segs; s++) { const p = a.clone().lerp(b, s / segs), dir = b.clone().sub(a).normalize(), side = new V(-dir.z, 0, dir.x); p.addScaledVector(side, off); p.y = groundAt(p.x, p.z) + hgt - (s % 2) * .04; pts.push(p); }
    wire.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs * 6, .004, 3, false));
  }
  return { wire: merged(wire), posts: merged(posts.map((g) => boxUV(g, .5))) };
}

// ------------------------------------------------------------------ 방파제
/** 바다 쪽(+Z)으로 휘어 파도를 되돌리는 단면의 콘크리트 방파제. 길이 len, 원점 = 바닥 중앙 */
export function seawallGeometry(len, h = 2.6) {
  const s = new THREE.Shape();   // (z, y) 단면, 육지 쪽 −Z
  s.moveTo(-.42, 0); s.lineTo(.45, 0); s.lineTo(.45, .25);
  s.bezierCurveTo(.15, .7, .12, 1.8, .38, h - .15); s.lineTo(.42, h); s.lineTo(-.3, h); s.lineTo(-.34, h - .08); s.lineTo(-.42, .1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 1, curveSegments: 10 });
  g.rotateY(-PI / 2); g.translate(len / 2, 0, 0);   // 단면의 x → 세계 z(바다 쪽 +), 돌출 길이 → 세계 x
  return boxUV(g, 2.5);
}

/** 흙 둔덕: 가장자리가 지면으로 스며드는 낮고 울퉁불퉁한 언덕(반구 대신). rx·rz 반경, h 높이, 원점 = 바닥 중심 */
export function mound(rx, h, rz, seed = 1) {
  const g = new THREE.PlaneGeometry(2, 2, 22, 22); g.rotateX(-PI / 2);
  const p = g.attributes.position;
  const n = (x, z) => Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed * 1.3) * .5 + Math.sin(x * 7.3 - z * 5.9 + seed * 2.1) * .25 + Math.cos(x * 13.7 + z * 11.1 + seed) * .1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.min(1, Math.hypot(x, z));
    const prof = Math.pow(Math.cos(r * PI / 2), 1.1);          // 꼭대기는 둥글고 가장자리는 완만
    const y = h * prof * (1 + n(x, z) * .28) - (r > .97 ? .3 : 0);   // 맨 바깥은 땅속으로
    const wob = 1 + n(z * 1.7, x * 1.3) * .12;
    p.setXYZ(i, x * rx * wob, y, z * rz * wob);
  }
  return boxUV(g, 3);
}
// ------------------------------------------------------------------ 벙커 (Regelbau 형 포대)
/** W×D×H 포대: 두꺼운 지붕판과 차양, 총안구 테두리를 단으로 깎은 앞벽, 옆면을 덮는 흙 둔덕. 원점 = 바닥 중심, 앞 = +Z */
export function bunkerParts(W = 8, D = 6, H = 2.8, slit = [1.05, 1.75]) {
  const concrete = [], earth = [], dark = [];
  const T = .6, fz = D / 2 - T / 2;
  // 앞벽: 총안구를 비워 두고 둘러싼다. 총안구 주변은 바깥으로 갈수록 넓어지는 계단형 테
  concrete.push(roundedBox(W, slit[0], T, .05).translate(0, slit[0] / 2, fz));
  concrete.push(roundedBox(W, H - slit[1], T, .05).translate(0, (H + slit[1]) / 2, fz));
  concrete.push(roundedBox(3, slit[1] - slit[0], T, .03).translate(-2.5, (slit[0] + slit[1]) / 2, fz));
  concrete.push(roundedBox(3, slit[1] - slit[0], T, .03).translate(2.5, (slit[0] + slit[1]) / 2, fz));
  for (let k = 1; k <= 2; k++) { // 계단형 테(총안구가 바깥쪽으로 넓어짐)
    const e = .14 * k, z = fz + T / 2 + .06 * k - .03;
    concrete.push(roundedBox(2 + e * 2 + .3, .12, .12, .02).translate(0, slit[1] + e, z));
    concrete.push(roundedBox(2 + e * 2 + .3, .12, .12, .02).translate(0, slit[0] - e, z));
    concrete.push(roundedBox(.12, slit[1] - slit[0] + e * 2, .12, .02).translate(-1 - e - .15, (slit[0] + slit[1]) / 2, z));
    concrete.push(roundedBox(.12, slit[1] - slit[0] + e * 2, .12, .02).translate(1 + e + .15, (slit[0] + slit[1]) / 2, z));
  }
  // 옆벽·뒷벽(가운데 출입구)
  concrete.push(roundedBox(T, H, D, .05).translate(-W / 2 + T / 2, H / 2, 0));
  concrete.push(roundedBox(T, H, D, .05).translate(W / 2 - T / 2, H / 2, 0));
  concrete.push(roundedBox(3.2, H, T, .05).translate(-2.4, H / 2, -D / 2 + T / 2));
  concrete.push(roundedBox(3.2, H, T, .05).translate(2.4, H / 2, -D / 2 + T / 2));
  // 지붕: 두꺼운 판 + 앞으로 튀어나온 차양, 윗면은 살짝 경사
  const roof = new THREE.Shape(); roof.moveTo(-D / 2 - .4, 0); roof.lineTo(D / 2 + .9, 0); roof.lineTo(D / 2 + .9, .35); roof.lineTo(D / 2 + .3, .7); roof.lineTo(-D / 2 - .4, .85); roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: W + .8, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 2 });
  rg.rotateY(-PI / 2); rg.translate((W + .8) / 2, H, 0); concrete.push(boxUV(rg, 2.5));
  // 흙 둔덕: 옆과 뒤를 덮어 지형에 묻힌 듯 보이게 (총안구 앞은 비움)
  for (const sx of [-1, 1]) earth.push(mound(3.4, H * .62, D * .72, sx * 3 + 1).translate(sx * (W / 2 + 1.1), -.15, -.4));
  earth.push(mound(W * .72, H * .85, 2.8, 7).translate(0, -.15, -D / 2 - 1));
  earth.push(mound(W * .6, .5, D * .52, 11).translate(0, H + .62, -.35));   // 지붕 위 위장 흙
  // 안쪽 어둠(총안구 너머가 비어 보이지 않게)
  dark.push(new THREE.BoxGeometry(W - 1.3, H - .2, D - 1.3).translate(0, H / 2, -.1));
  return { concrete: merged(concrete), earth: merged(earth), dark: merged(dark.map(prep)) };
}
/** MG42: 구멍 뚫린 총열 덮개, 총몸, 개머리, 양각대, 탄띠. 총열이 +Z, 원점 = 총몸 중앙 */
export function mg42Geometry() {
  const steel = [], wood = [];
  steel.push(roundedBox(.07, .1, .46, .012, .3).translate(0, 0, 0));
  const jacket = new THREE.CylinderGeometry(.026, .026, .5, 12, 1, true); jacket.rotateX(PI / 2); jacket.translate(0, .01, .48); steel.push(boxUV(jacket, .3));
  const muzzle = new THREE.CylinderGeometry(.03, .022, .08, 10); muzzle.rotateX(PI / 2); muzzle.translate(0, .01, .76); steel.push(boxUV(muzzle, .3));
  for (const s of [-1, 1]) { const leg = new THREE.CylinderGeometry(.008, .008, .4, 5); leg.rotateX(.5); leg.rotateZ(s * .35); leg.translate(s * .07, -.16, .55); steel.push(boxUV(leg, .3)); }
  steel.push(roundedBox(.05, .05, .08, .01, .3).translate(0, -.07, -.05));
  const stock = new THREE.Shape(); stock.moveTo(0, 0); stock.lineTo(.36, .02); stock.lineTo(.38, -.1); stock.lineTo(.06, -.07); stock.closePath();
  const sg = new THREE.ExtrudeGeometry(stock, { depth: .045, bevelEnabled: true, bevelThickness: .006, bevelSize: .006, bevelSegments: 1 }); sg.rotateY(-PI / 2); sg.translate(.022, -.01, -.22); wood.push(boxUV(sg, .3));
  for (let i = 0; i < 9; i++) { const r = new THREE.CylinderGeometry(.006, .006, .07, 5); r.rotateZ(PI / 2); r.translate(-.07 - i * .018, -.04 - i * .012, .02); steel.push(boxUV(r, .3)); }   // 늘어진 탄띠
  return { steel: merged(steel), wood: merged(wood) };
}

// ------------------------------------------------------------------ 파괴된 M4 셔먼
/** 원점 = 차체 바닥 중심, 앞 = −Z (해안 쪽). 포탑은 피격으로 돌아가 있고 포신은 처져 있다 */
export function shermanParts() {
  const hull = [], track = [], wheel = [];
  // 차체 옆 단면: 경사진 앞판(글래시스)과 뒤 엔진 덮개
  const side = new THREE.Shape();
  side.moveTo(-2.9, .45); side.lineTo(-2.6, .45); side.lineTo(2.75, .45); side.lineTo(2.95, .7); side.lineTo(2.95, 1.75); side.lineTo(2.55, 1.95);
  side.lineTo(-1.1, 1.95); side.lineTo(-2.5, 1.35); side.lineTo(-2.95, 1.0); side.closePath();
  const hg = new THREE.ExtrudeGeometry(side, { depth: 2.55, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2 });
  hg.rotateY(-PI / 2); hg.translate(1.275, 0, 0); hull.push(boxUV(hg, 1.5));   // 단면 x → 세계 z (앞 = −Z)
  // 포탑: 둥근 주조 포탑(Lathe) + 포방패 + 처진 포신 + 해치
  const turret = new THREE.LatheGeometry([[0, 0], [.95, 0], [1.02, .18], [.98, .55], [.8, .78], [.4, .9], [0, .92]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
  turret.scale(1, 1, 1.15); turret.rotateY(.6); turret.rotateZ(.08); turret.translate(.05, 1.95, -.25); hull.push(boxUV(turret, 1.5));
  const mant = roundedBox(.9, .5, .3, .08, 1); mant.rotateY(.6); mant.translate(-.62 + .05, 2.3, -1.15); hull.push(mant);
  const gun = new THREE.CylinderGeometry(.06, .07, 2.6, 10); gun.rotateX(PI / 2 - .18); gun.rotateY(.6); gun.translate(-1.25, 2.05, -2.15); hull.push(boxUV(gun, 1));
  const hatch = new THREE.CylinderGeometry(.3, .3, .06, 14); hatch.rotateX(-1.1); hatch.translate(.3, 3.0, .25); hull.push(boxUV(hatch, 1));
  // 궤도: 앞뒤가 둥근 고리 단면을 돌출
  for (const sx of [-1, 1]) {
    const tr = new THREE.Shape(); tr.absarc(-2.35, .5, .48, PI / 2, PI * 1.5, false); tr.lineTo(2.35, .02); tr.absarc(2.35, .5, .48, -PI / 2, PI / 2, false); tr.closePath();
    const hole = new THREE.Path(); hole.absarc(-2.35, .5, .36, PI / 2, PI * 1.5, false); hole.lineTo(2.35, .14); hole.absarc(2.35, .5, .36, -PI / 2, PI / 2, false); hole.closePath(); tr.holes.push(hole);
    const tg = new THREE.ExtrudeGeometry(tr, { depth: .45, bevelEnabled: false, curveSegments: 10 }); tg.rotateY(-PI / 2); tg.translate(sx * 1.33 + .225, 0, 0); track.push(boxUV(tg, .4));
    // VVSS 보기 3개(바퀴 2개씩) + 위 롤러
    for (const bz of [-1.55, 0, 1.55]) for (const dz of [-.33, .33]) { const w = new THREE.CylinderGeometry(.26, .26, .22, 14); w.rotateZ(PI / 2); w.translate(sx * 1.33, .38, bz + dz); wheel.push(boxUV(w, .5)); }
    for (const bz of [-1.55, 0, 1.55]) { const b = roundedBox(.3, .42, .62, .05, .5); b.translate(sx * 1.2, .55, bz); hull.push(b); }
    for (const rz of [-2.35, 2.35]) { const s = new THREE.CylinderGeometry(.42, .42, .25, 16); s.rotateZ(PI / 2); s.translate(sx * 1.33, .5, rz); wheel.push(boxUV(s, .5)); }
  }
  return { hull: merged(hull), track: merged(track), wheel: merged(wheel) };
}

// ------------------------------------------------------------------ 히긴스 상륙정 (LCVP)
/** 원점 = 선체 바닥 뒤쪽 기준점, 램프가 −Z(해안 쪽)로 내려져 있다. 길이 약 11m */
export function higginsParts() {
  const ply = [], steel = [];
  // 선체 평면형: 뒤는 둥글고 앞은 램프 폭
  const plan = new THREE.Shape(); plan.moveTo(-1.65, 0); plan.lineTo(1.65, 0); plan.lineTo(1.8, 7.5); plan.quadraticCurveTo(1.8, 10.6, 0, 10.9); plan.quadraticCurveTo(-1.8, 10.6, -1.8, 7.5); plan.closePath();
  const hole = new THREE.Path(); hole.moveTo(-1.5, .1); hole.lineTo(1.5, .1); hole.lineTo(1.62, 7.5); hole.quadraticCurveTo(1.62, 10.4, 0, 10.7); hole.quadraticCurveTo(-1.62, 10.4, -1.62, 7.5); hole.closePath(); plan.holes.push(hole);
  const sides = new THREE.ExtrudeGeometry(plan, { depth: 1.9, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 1, curveSegments: 10 });
  { // 바닥 쪽으로 좁아지는 선체(상자처럼 보이지 않게) + 선미가 조금 높은 현호
    const p = sides.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = Math.min(1, Math.max(0, z / 1.9));
      const k = .8 + .2 * Math.min(1, t / .55) ** .6;
      p.setXYZ(i, x * k, y * (y > 7.5 ? .97 + .03 * k : 1), z + (z > 1 ? (y / 10.9) * .25 : 0));
    }
  }
  sides.rotateX(-PI / 2); sides.rotateY(PI); ply.push(boxUV(sides, 1.2));   // 평면 y → 세계 +Z (선미 쪽), 돌출 → 높이
  { // 뱃전 테두리(강철 띠)
    const rim = new THREE.Shape(); rim.moveTo(-1.72, 0); rim.lineTo(1.72, 0); rim.lineTo(1.87, 7.5); rim.quadraticCurveTo(1.87, 10.7, 0, 11); rim.quadraticCurveTo(-1.87, 10.7, -1.87, 7.5); rim.closePath();
    const rh = new THREE.Path(); rh.moveTo(-1.45, .05); rh.lineTo(1.45, .05); rh.lineTo(1.57, 7.5); rh.quadraticCurveTo(1.57, 10.35, 0, 10.62); rh.quadraticCurveTo(-1.57, 10.35, -1.57, 7.5); rh.closePath(); rim.holes.push(rh);
    const g = new THREE.ExtrudeGeometry(rim, { depth: .09, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1, curveSegments: 10 });
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 1.86 + (p.getY(i) / 10.9) * .25);
    g.rotateX(-PI / 2); g.rotateY(PI); steel.push(boxUV(g, .8));
  }
  // 측면 보강 늑재(세로 띠)
  for (const sx of [-1, 1]) for (let z = 1.2; z < 7.5; z += 1.25) steel.push(roundedBox(.05, 1.6, .12, .015, .6).translate(sx * (1.67 + (z / 7.5) * .1), 1.02, z));
  const floor = new THREE.ShapeGeometry(plan); floor.rotateX(-PI / 2); floor.rotateY(PI); floor.translate(0, .08, 0); ply.push(boxUV(floor, 1.2));
  // 뒤쪽 조타실 갑판과 장갑판
  const deck = roundedBox(3.4, .4, 2.6, .05, 1.2); deck.translate(0, 1.7, 9.4); ply.push(deck);
  for (const sx of [-1, 1]) steel.push(roundedBox(.08, .7, 1.1, .02, .6).translate(sx * .8, 2.25, 8.6));
  // 앞 램프: 내려진 강철판 + 가로 늑재
  const ramp = new THREE.Group();
  const rp = roundedBox(3.3, .08, 2.9, .02, .8); rp.translate(0, 0, -1.45); steel.push(rp.applyMatrix4(new THREE.Matrix4().makeRotationX(-.18)));
  for (let i = 0; i < 6; i++) { const r = new THREE.BoxGeometry(3.2, .06, .06); r.translate(0, .07, -.3 - i * .45); r.applyMatrix4(new THREE.Matrix4().makeRotationX(-.18)); steel.push(boxUV(r, .6)); }
  for (const sx of [-1, 1]) { const h = new THREE.CylinderGeometry(.06, .06, .5, 10); h.rotateZ(PI / 2); h.translate(sx * 1.4, .25, 0); steel.push(boxUV(h, .5)); }
  void ramp;
  return { ply: merged(ply), steel: merged(steel) };
}

// ------------------------------------------------------------------ 참호 판자벽
/** 사대 뒤 참호의 나무 판자 벽·말뚝·발판. len 길이, 원점 = 지면 중앙 */
export function trenchRevetment(len) {
  const wood = [];
  for (const side of [-.55, .55]) {
    for (let h = 0; h < 3; h++) wood.push(roundedBox(len, .2, .05, .01, 1).translate(0, .12 + h * .22, side));
    for (let x = -len / 2 + .3; x < len / 2; x += 1.6) wood.push(roundedBox(.09, .9, .09, .01, 1).translate(x, .45, side + (side > 0 ? .06 : -.06)));
  }
  for (let x = -len / 2 + .5; x < len / 2 - .3; x += 1.2) { wood.push(roundedBox(.9, .05, .12, .01, 1).translate(x, .04, -.2)); wood.push(roundedBox(.9, .05, .12, .01, 1).translate(x, .04, .2)); wood.push(roundedBox(.08, .05, .62, .01, 1).translate(x - .35, .02, 0)); }
  return merged(wood);
}
