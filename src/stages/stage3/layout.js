// Stage 3 — 코브라 작전(생로 서쪽, 1944년 7월 25일 이후). 융단 폭격으로 파인 들판을 지나 폐허가 된 마을의 교차로를 확보한다.
// 진행: 남쪽(+z) 폭격 지대 → 마을 외곽(기관총 진지·대전차포) → 교차로(반격) → 북쪽 면사무소(지휘 거점)
//
//  z=100  출발 — 폭격으로 뒤집힌 들판(큰 구덩이, 부러진 나무, 불탄 독일군 진지)
//  z= 62  집결지 — 셔먼 전차와 분대(아군 합류)
//  z= 20  마을 외곽 — MG42 2곳(모래주머니 진지, 무너진 집 2층 창문), 불타는 트럭
//  z=  0  대전차포(Pak 40) 2문 — 길을 겨눔
//  z=-20  교차로 (남북 도로 x=0, 동서 도로) — 도착하면 독일군 반격
//  z=-52  면사무소(지휘 거점), 성당(무너진 종탑)
export const BOUNDS = { minX: -80, maxX: 80, minZ: -98, maxZ: 110 };
export const ENEMY_BOX = { minX: -70, maxX: 70, minZ: -92, maxZ: 60 };
export const PLAYER_BOX = { minX: -72, maxX: 72, minZ: -94, maxZ: 104 };

export const ROAD_X = 0, CROSS_Z = -20;            // 남북 도로 x=0(폭 7m), 동서 도로 z=-20(폭 7m)
export const RALLY = { x: 6, z: 62 };              // 셔먼 전차·분대 집결지
export const MG_NESTS = [{ x: -26, z: 18, kind: 'nest' }, { x: 21, z: 13, kind: 'window', y: 3.4 }];   // y = 2층 바닥 높이
export const AT_GUNS = [{ x: -6.5, z: 4, yaw: .15 }, { x: 15, z: -4, yaw: -.25 }];   // 남쪽 도로를 겨눔
export const CP = { x: 22, z: -54, w: 14, d: 10, floors: 2 };          // 면사무소
export const CP_ROOM = { minX: 15.5, maxX: 22, minZ: -58.5, maxZ: -49.5 };   // 서쪽 방(지휘소)
export const CHURCH = { x: -24, z: -58, w: 11, d: 20 };
export const COUNTER_SPAWNS = [[-40, -86], [-6, -90], [8, -90], [44, -84], [62, -28], [-62, -24]];   // 반격 병력이 들어오는 곳

/** 마을 집: 중심·크기·층수·피해(0 멀쩡 ~ 1 거의 무너짐)·문 방향(도로 쪽 면: 'e'|'w'|'n'|'s') */
export const HOUSES = [
  // 남북 도로 서쪽 줄
  { x: -12, z: 12, w: 9, d: 7, floors: 2, dmg: .55, face: 'e' }, { x: -13, z: -6, w: 8, d: 9, floors: 2, dmg: .3, face: 'e' },
  { x: -12, z: -36, w: 9, d: 8, floors: 2, dmg: .7, face: 'e' }, { x: -13, z: -72, w: 8, d: 8, floors: 1, dmg: .4, face: 'e' },
  // 남북 도로 동쪽 줄
  { x: 21, z: 13, w: 8, d: 8, floors: 2, dmg: .45, face: 'w' }, { x: 13, z: -34, w: 9, d: 8, floors: 2, dmg: .8, face: 'w' },
  { x: 12, z: -74, w: 8, d: 9, floors: 1, dmg: .5, face: 'w' },
  // 동서 도로 양쪽
  { x: -32, z: -10, w: 10, d: 8, floors: 2, dmg: .6, face: 's' }, { x: -46, z: -30, w: 9, d: 8, floors: 1, dmg: .35, face: 'n' },
  { x: 36, z: -10, w: 9, d: 8, floors: 2, dmg: .5, face: 's' }, { x: 40, z: -30, w: 10, d: 8, floors: 2, dmg: .9, face: 'n' },
  { x: 55, z: -10, w: 8, d: 7, floors: 1, dmg: .7, face: 's' }, { x: -54, z: -9, w: 8, d: 7, floors: 1, dmg: .5, face: 's' },
];
/** 불타는 차량(연기 기둥·불빛) */
export const WRECKS = [{ x: -5, z: 24, kind: 'truck', yaw: .4, burning: true }, { x: 9, z: -30, kind: 'halftrack', yaw: 1.4, burning: true }, { x: 34, z: 40, kind: 'panzer', yaw: -.5, burning: false }, { x: -40, z: 48, kind: 'truck', yaw: 2.2, burning: true }];
/** 융단 폭격 구덩이: 남쪽 들판에 많이, 마을에는 몇 개 */
let s = 7251944; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
export const CRATERS3 = [];
for (let i = 0; i < 46; i++) { const x = -70 + r() * 140, z = 30 + r() * 72; if (Math.abs(x - RALLY.x) < 9 && Math.abs(z - RALLY.z) < 9) continue; if (Math.abs(x) < 5 && r() < .6) continue; CRATERS3.push({ x, z, r: 2.4 + r() * 3.2, d: .9 + r() * 1.1 }); }
for (const [x, z] of [[4, -48], [-30, -42], [30, -66], [-2, 6], [48, 6], [-50, 10]]) CRATERS3.push({ x, z, r: 2.6, d: .9 });
