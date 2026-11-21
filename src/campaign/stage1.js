// Stage 1 — 오마하 해변의 목표. 기존 전투(배치·AI·승리 조건)는 그대로 두고, 진행 상황을 5단계 목표로 읽는다.
//   ctx = { player, enemies, allies }   (enemies[i].zone: 'mg' | 'line' | 'rear' — 처음 배치 위치로 정함)
const BUNKERS = [-36, 0, 36], BZ = -39, GAPS = [-37, -9, 13, 41];
const near = (p, list) => { let best = null, bd = 1e9; for (const t of list) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return best; };
const alive = (ctx, f) => ctx.enemies.filter((e) => e.alive && f(e));

export const STAGE1_OBJECTIVES = [
  { // 1. 해변 건너 방파제까지
    done: (c) => c.player.pos.z < 2,
    progress: (c) => `방파제까지 ${Math.max(0, Math.round(c.player.pos.z - 2))}m`,
    target: (c) => near(c.player.pos, GAPS.map((x) => ({ x, z: 0 }))),
  },
  { // 2. 기관총 진지 3곳
    done: (c) => alive(c, (e) => e.zone === 'mg').length === 0,
    progress: (c) => `남은 기관총 진지 ${alive(c, (e) => e.zone === 'mg').length}/3`,
    target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'mg')),
  },
  { // 3. 벙커 안으로 (뒤쪽 출입구)
    done: (c) => BUNKERS.some((bx) => Math.abs(c.player.pos.x - bx) < 3.3 && c.player.pos.z < BZ + 2.4 && c.player.pos.z > BZ - 2.4),
    progress: () => '벙커 뒤쪽 출입구로 들어가라',
    target: (c) => near(c.player.pos, BUNKERS.map((x) => ({ x, z: BZ - 4 }))),
  },
  { // 4. 능선 방어선(절벽 위 사대·참호·전방)의 남은 적
    done: (c) => alive(c, (e) => e.zone === 'line' || e.zone === 'mg').length === 0,
    progress: (c) => `방어선의 적 ${alive(c, (e) => e.zone === 'line' || e.zone === 'mg').length}명`,
    target: (c) => near(c.player.pos, alive(c, (e) => e.zone === 'line' || e.zone === 'mg')),
  },
  { // 5. 후방 거점까지 전멸 → 교두보 확보 (기존 승리 조건과 같음)
    done: (c) => alive(c, () => true).length === 0,
    progress: (c) => `후방 거점의 적 ${alive(c, () => true).length}명`,
    target: (c) => near(c.player.pos, alive(c, () => true)),
  },
];

/** 처음 배치 위치로 적의 구역을 정한다(움직여도 바뀌지 않게 시작할 때 한 번) */
export function tagStage1Zones(enemies) { for (const e of enemies) e.zone = e.type === 'mg' ? 'mg' : e.z > -45 ? 'line' : 'rear'; }
