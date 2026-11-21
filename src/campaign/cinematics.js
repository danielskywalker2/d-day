// 스테이지별 인트로·아웃트로 대본. 카메라는 실제 전장을 지나간다.
// shots: [{ d: 초, a/b: 카메라 시작·끝 [x, 지면 위 높이, z], la/lb: 바라보는 점 시작·끝, fov }]
// title: { t: 나타나는 시각, d: 보이는 시간, meta, en(영어 작전명), ko }
// lines: [{ t, d, who, text, radio }] — radio 면 무전 잡음과 함께 녹색 자막
// 실제 역사(날짜·장소·작전명)와 창작(분대의 임무·대사)을 섞되 브리핑의 '역사/임무' 구분을 따른다.

const meta = (S) => `STAGE ${S.id} · ${S.dateShort} · ${S.location}`;
/** 아웃트로: 결과 → 다음 이야기(스테이지 데이터의 outro·next 문장 사용) */
const outroLines = (S, t0 = 1.2) => {
  const parts = S.outro.split(/(?<=[.다])\s+/).filter(Boolean), out = []; let t = t0;
  for (const p of parts.slice(0, 3)) { out.push({ t, d: 3.4, who: '', text: p }); t += 3.5; }
  out.push({ t, d: 3.2, who: '다음 작전', text: S.next.replace(/^다음:\s*/, '') });
  return out;
};

export const CINEMATICS = {
  1: {
    intro: (S) => ({ music: 'tense',
      shots: [
        { d: 6, a: [-34, 8, 122], b: [-16, 6, 102], la: [0, 2, -37], lb: [6, 2, -37], fov: 50 },
        { d: 5, a: [-44, 2.2, 52], b: [26, 2.4, 48], la: [-20, 2, 20], lb: [30, 2, 18], fov: 55 },
        { d: 5.5, a: [2, 4, 26], b: [0, 6, 4], la: [0, 1.5, -37], fov: 48 },
      ],
      title: { t: 1, d: 4.4, meta: meta(S), en: 'OPERATION OVERLORD', ko: '노르망디 상륙 작전 — 오마하 해변' },
      lines: [
        { t: 6.2, d: 4.4, who: '무전', radio: true, text: '여기는 이지 레드. 제1파, 해변까지 500야드. 장애물과 기관총을 조심하라.' },
        { t: 11.2, d: 5, who: '분대장', text: '절벽 위 기관총 진지를 부숴야 다들 산다. 방파제까지 뛰어!' },
      ] }),
    outro: (S) => ({ music: 'somber',
      shots: [{ d: 7, a: [0, 9, -40], b: [0, 13, -46], la: [0, 0, 40], lb: [0, 0, 60], fov: 55 }, { d: 7, a: [-30, 14, -30], b: [30, 16, -34], la: [0, 0, 30], fov: 55 }],
      title: { t: 1, d: 3.5, meta: meta(S), en: 'MISSION COMPLETE', ko: `${S.title} — 교두보 확보` },
      lines: outroLines(S, 4.6) }),
  },
  2: {
    intro: (S) => ({ music: 'tense',
      shots: [
        { d: 5.5, a: [2.5, 3.4, 108], b: [1, 3, 88], la: [0, 1.6, 60], fov: 55 },
        { d: 5.5, a: [-62, 28, 82], b: [-22, 32, 22], la: [0, 0, -20], lb: [10, 0, -50], fov: 55 },
        { d: 5, a: [24, 9, -34], b: [8, 7, -52], la: [-6, 3, -72], fov: 50 },
      ],
      title: { t: 1, d: 4.2, meta: meta(S), en: 'THE HEDGEROWS', ko: '보카주 전투 — 생울타리 지대' },
      lines: [
        { t: 5.8, d: 4.6, who: '무전', radio: true, text: '해변은 확보했다. 하지만 생울타리마다 독일군이 숨어 있다.' },
        { t: 10.8, d: 4.8, who: '분대장', text: '앞서 간 정찰병부터 찾는다. 목표는 농가에 있는 독일군 지휘소다.' },
      ] }),
    outro: (S) => ({ music: 'somber',
      shots: [{ d: 7, a: [10, 6, -56], b: [0, 12, -40], la: [-6, 2, -72], lb: [0, 0, 0], fov: 55 }, { d: 7, a: [-44, 18, -56], b: [-18, 20, -4], la: [10, 0, 40], fov: 55 }],
      title: { t: 1, d: 3.5, meta: meta(S), en: 'MISSION COMPLETE', ko: `${S.title} — 보급로 확보` },
      lines: outroLines(S, 4.6) }),
  },
  3: {
    intro: (S) => ({ music: 'tense',
      shots: [
        { d: 5.5, a: [-30, 15, 108], b: [6, 13, 74], la: [0, 0, 20], fov: 55 },
        { d: 5, a: [16, 2.6, 72], b: [11, 2.2, 56], la: [6, 1.6, 62], fov: 50 },
        { d: 5.5, a: [2, 10, 40], b: [0, 6, 18], la: [0, 2, -24], fov: 52 },
      ],
      title: { t: 1, d: 4.2, meta: meta(S), en: 'OPERATION COBRA', ko: '코브라 작전 — 생로 돌파' },
      lines: [
        { t: 5.8, d: 4.6, who: '무전', radio: true, text: '융단 폭격 종료. 독일군 전선에 구멍이 뚫렸다. 전 부대 전진.' },
        { t: 10.8, d: 5, who: '전차장', text: '대전차포가 살아 있으면 내 셔먼은 못 나간다. 길을 열어 줘.' },
      ] }),
    outro: (S) => ({ music: 'somber',
      shots: [{ d: 7, a: [4, 4, -36], b: [10, 7, -44], la: [22, 3, -54], fov: 52 }, { d: 7, a: [0, 15, -62], b: [0, 18, -24], la: [0, 0, 30], fov: 55 }],
      title: { t: 1, d: 3.5, meta: meta(S), en: 'MISSION COMPLETE', ko: `${S.title} — 교차로 확보` },
      lines: outroLines(S, 4.6) }),
  },
  4: {
    intro: (S) => ({ music: 'tense',
      shots: [
        { d: 5.5, a: [0, 1.8, 109], b: [0, 2.6, 92], la: [0, 7, 40], fov: 55 },
        { d: 5, a: [-3, 2, 70], b: [-6, 1.9, 64], la: [-11, 1.4, 60], fov: 50 },
        { d: 5.5, a: [0, 26, 10], b: [0, 22, -28], la: [0, 8, -100], fov: 52 },
      ],
      title: { t: 1, d: 4.2, meta: meta(S), en: 'LIBERATION OF PARIS', ko: '파리 해방' },
      lines: [
        { t: 5.8, d: 4.6, who: '무전', radio: true, text: '파리 시민이 봉기했다. 레지스탕스가 거리마다 바리케이드를 쌓고 있다.' },
        { t: 10.8, d: 5, who: '분대장', text: '카페에서 레지스탕스와 만난다. 민간인은 절대 다치게 하지 마라.' },
      ] }),
    outro: (S) => ({ music: 'triumph',
      shots: [{ d: 7, a: [0, 1.8, -70], b: [0, 2.2, -78], la: [0, 24, -97], lb: [0, 26, -97], fov: 58 }, { d: 7, a: [-20, 18, -60], b: [20, 20, -62], la: [0, 4, -88], fov: 55 }],
      title: { t: 1, d: 3.5, meta: meta(S), en: 'PARIS IS FREE', ko: '파리가 해방되었다' },
      lines: outroLines(S, 4.6) }),
  },
  5: {
    intro: (S) => ({ music: 'tense',
      shots: [
        { d: 5.5, a: [0, 2, 112], b: [0, 2.4, 98], la: [0, 2, 70], fov: 55 },
        { d: 5.5, a: [-44, 14, 40], b: [22, 12, 30], la: [-10, 0, 12], lb: [20, 0, 8], fov: 55 },
        { d: 5, a: [14, 17, -46], b: [12, 15, -62], la: [10, 2, -86], fov: 50 },
      ],
      title: { t: 1, d: 4.2, meta: meta(S), en: 'THE LAST FRONTIER', ko: '지크프리트선 — 독일 국경' },
      lines: [
        { t: 5.8, d: 4.6, who: '무전', radio: true, text: '독일 국경이다. 콘크리트 벙커와 용의 이빨이 숲을 가로지른다.' },
        { t: 10.8, d: 4.8, who: '분대장', text: '먼저 정찰한다. 저 언덕 위가 마지막 방어 거점이다.' },
      ] }),
    // 캠페인 1부의 끝: 독일 본토를 바라보며 본부 무전 → THE WAR IS NOT OVER.
    outro: (S) => ({ music: 'somber',
      shots: [{ d: 8, a: [10, 1.8, -90], b: [10, 3.2, -97], la: [0, 6, -250], lb: [-10, 10, -260], fov: 55 }, { d: 7, a: [10, 3.2, -97], b: [10, 9, -100], la: [-10, 10, -260], lb: [-20, 16, -300], fov: 50 }],
      title: { t: 9.5, d: 5.4, meta: 'END OF CAMPAIGN – PART ONE', en: 'THE WAR IS NOT OVER.', ko: '아직 전쟁은 끝나지 않았다' },
      lines: [
        { t: 1.2, d: 3.6, who: '', text: '분대는 지크프리트선의 마지막 거점을 점령했다.' },
        { t: 4.4, d: 4.8, who: '본부', radio: true, text: '여기는 본부다. 아직 전쟁은 끝나지 않았다. 우리는 계속 진격한다.' },
      ] }),
  },
};
