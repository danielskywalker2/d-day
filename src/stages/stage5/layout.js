// Stage 5 — 마지막 국경(THE LAST FRONTIER): 1944년 가을, 아헨 남쪽 독일 국경의 서부 방벽(지크프리트선).
//
//  z=106      출발 — 국경 숲(가문비나무·단풍 든 너도밤나무), 아군 3명
//  (-34, 62)  정찰 지점(OP) — 숲 가장자리 언덕. 벙커 2곳과 박격포 진지를 확인
//  z≈ 30      야전 방어선 — 지그재그 참호, MG42 2정, 철조망. 뒤쪽 나무 위에 장거리 저격수 2명
//  z= 12~17   용의 이빨(콘크리트 대전차 장애물 4줄) — 길목(차단물)과 폭파된 틈(x≈-36)으로만 지나감
//  z≈  0      지크프리트선 벙커 2곳(총안구 MG) + 뒤쪽 박격포 진지
//  z=-20~-52  언덕 아래 지하 지휘 벙커(경사로로 내려감): 복도·막사·지휘실·탄약고
//  (10,-86)   언덕 꼭대기 마지막 요새(관측 벙커) — 동쪽 너머가 독일 본토
export const BOUNDS = { minX: -110, maxX: 110, minZ: -160, maxZ: 160 };
export const PLAYER_BOX = { minX: -72, maxX: 72, minZ: -104, maxZ: 114 };
export const ENEMY_BOX = { minX: -70, maxX: 70, minZ: -104, maxZ: 60 };

export const OP = { x: -34, z: 62, r: 5 };
/** 지그재그 참호(야전 방어선) */
export const TRENCH = [[-72, 32], [-52, 28], [-36, 33], [-20, 28], [-6, 32], [8, 28], [22, 33], [38, 28], [52, 32], [72, 29]];
export const WIRE_Z = 39;
export const TEETH = { z0: 12, rows: 4, gap: 1.6, breach: [-39, -33] };
export const roadX = (z) => 3 + 5 * Math.sin(z * .025);
export const BUNKERS = [{ x: -26, z: 2, W: 8, D: 6, H: 2.8 }, { x: 26, z: 0, W: 8, D: 6, H: 2.8 }];
export const MORTAR = { x: -2, z: -12 };
export const SNIPER_STANDS = [{ x: -46, z: -14, h: 6.5 }, { x: 50, z: -20, h: 6.5 }];
/** 지하 지휘 벙커(바닥 높이는 terrain.js 가 계산) */
export const HQ = { x0: -6, x1: 16, z0: -52, z1: -32, door: { x: 5, z: -32 }, ramp: { x0: 4, x1: 6, z0: -32, z1: -20 } };
export const HQ_ROOM = { minX: 7, maxX: 15.6, minZ: -41.6, maxZ: -32.4 };   // 지휘실(작전 지도·무전기)
export const FINAL = { x: 10, z: -86, r: 12 };
export const LOOK_TARGETS = [{ name: '서쪽 벙커', x: -26, z: 5 }, { name: '동쪽 벙커', x: 26, z: 3 }, { name: '박격포 진지', x: -2, z: -12 }];
