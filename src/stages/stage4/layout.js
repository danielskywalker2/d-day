// Stage 4 — 파리 해방(1944년 8월 25일). 큰길(불바르)을 따라 북쪽의 광장과 구청(시청 형태)까지.
//
//  z=104  출발 — 큰길 남쪽(미군 2명)
//  z= 61  서쪽 골목 입구의 카페 — 레지스탕스(FFI) 접선
//  z= 38  독일군 검문소 — 모래주머니 지그재그, 차단봉, 퀴벨바겐, MG42, 창문 저격수 2명
//  z=  0  동쪽 점령 건물(1층으로 들어감) — 안쪽 방에 민간인 4명
//  z= 10  서쪽 골목 = FFI 바리케이드 뒤 안전지대(독일군 2명이 골목을 지킴)
//  z=-45~-95  광장 — 독일군 진지, 북쪽 끝 구청(시청)
export const BOUNDS = { minX: -64, maxX: 64, minZ: -112, maxZ: 112 };
export const PLAYER_BOX = { minX: -58, maxX: 58, minZ: -100, maxZ: 106 };
export const ENEMY_BOX = { minX: -56, maxX: 56, minZ: -98, maxZ: 60 };
export const STREET_H = 1.0, CURB = .15;
export const ROAD = { half: 7, walk: 10 };   // 차도 ±7m, 인도 ±10m

/** 오스만식 건물 블록(축에 나란한 직사각형). 높이 = 1층 4.5m + 위층 4개 × 3.2m + 망사르 지붕. streets = 거리 쪽 면(창문을 만듦) */
export const BLOCKS = [
  { x0: -42, x1: -10, z0: 66, z1: 108, streets: ['e'] }, { x0: -42, x1: -10, z0: 14, z1: 56, streets: ['e', 'n'] }, { x0: -42, x1: -10, z0: -42, z1: 6, streets: ['e', 's'] },
  { x0: 10, x1: 42, z0: 58, z1: 108, streets: ['w'] }, { x0: 10, x1: 42, z0: 18, z1: 50, streets: ['w', 'n'] }, { x0: 32, x1: 42, z0: -16, z1: 12, streets: ['w'] },
  { x0: 10, x1: 42, z0: -42, z1: -24, streets: ['w', 'n'] },
  { x0: -62, x1: -46, z0: -96, z1: -42, streets: ['e'] }, { x0: 46, x1: 62, z0: -96, z1: -42, streets: ['w'] },
  // 골목 끝을 막는 뒤쪽 건물
  { x0: -62, x1: -42, z0: 56, z1: 66, streets: [] }, { x0: -62, x1: -42, z0: 6, z1: 14, streets: [] }, { x0: 42, x1: 62, z0: 50, z1: 58, streets: [] }, { x0: 42, x1: 62, z0: -24, z1: 18, streets: [] },
];
/** 점령 건물: 동쪽 x 10~32, z -16~12. 1층은 실제로 들어가는 방, 위층은 외벽만 */
export const OCCUPIED = { x0: 10, x1: 32, z0: -16, z1: 12, door: { x: 10, z: 1 } };
export const BACK_ROOM = { minX: 22.3, maxX: 31.6, minZ: -15.6, maxZ: -4.3 };   // 민간인이 갇힌 안쪽 방
export const CAFE = { x: -13, z: 61 };                                   // 레지스탕스 접선 장소(서쪽 골목 입구)
export const CHECKPOINT = { z: 38 };
export const SAFE = { x: -26, z: 10, r: 6 };                             // 안전지대(서쪽 골목 안, FFI 바리케이드 뒤)
export const SQUARE = { z0: -95, z1: -42 };
export const HALL = { x: 0, z: -100, w: 64, d: 10, door: { x: 0, z: -95 } };   // 구청(광장 북쪽)
/** 민간인이 피하는 길: 안쪽 방 → 복도 → 출입문 → 큰길 건너 → 서쪽 골목 → 안전지대 */
export const EVAC_PATH = [[27, -9], [21, -9], [15, -9], [15, -3], [15, 1], [11, 1], [8, 1], [0, 6], [-9, 10], [-16, 10], [-24, 10]];
export const WINDOW_SNIPERS = [{ x: -9.6, z: 30, y: 5.64 }, { x: 9.6, z: 24, y: 5.64 }];   // 2층 발코니 위(y = 발코니 바닥)
