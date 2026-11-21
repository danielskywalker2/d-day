// TerrainMaterial — 지형 6층 PBR 블렌딩 (MeshStandardMaterial 에 셰이더 조각을 끼워 넣어 그림자·안개·환경광을 그대로 쓴다).
//   0 마른 모래 · 1 젖은 모래 · 2 자갈 · 3 진흙 · 4 풀 · 5 포격으로 그을린 땅
// 정점마다 층 가중치(splatA = 1..4, splatB.x = 5)를 넣고, 텍스처 밝기를 높이처럼 써서 경계를 자연스럽게 섞는다.
// UV 는 세계 좌표(xz)로 만든다 — 메시 크기와 무관하게 실제 크기에 맞는 무늬.
import * as THREE from 'three';

export const BEACH_LAYERS = [
  { name: 'coast_sand_01', tile: 3.2, rough: .92 },
  { name: 'damp_beach_sand', tile: 3.0, rough: .42 },
  { name: 'rocky_gravel', tile: 2.2, rough: .85 },
  { name: 'brown_mud', tile: 2.6, rough: .62 },
  { name: 'sparse_grass', tile: 3.4, rough: .95 },
  { name: 'burned_ground_01', tile: 3.0, rough: .95 },
];

/** layers: 6개 [{ name, tile(m), rough }] — 0층은 기본, 1~5층은 정점 가중치 splatA.xyzw·splatB.x */
export function createTerrainMaterial(assets, LAYERS = BEACH_LAYERS) {
  const diff = LAYERS.map((l) => assets.texture(`./assets/${l.name}_diff.jpg`, { srgb: true }));
  const nor = LAYERS.map((l) => assets.texture(`./assets/${l.name}_nor.jpg`, { kind: 'normal' }));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: diff[0], normalMap: nor[0], roughness: 1, metalness: 0 });
  mat.normalScale.set(1.1, 1.1);
  mat.onBeforeCompile = (sh) => {
    // 0층은 재질 자신의 map / normalMap 을 쓴다(텍스처 유닛 절약: 그림자·환경맵까지 14개)
    diff.forEach((t, i) => { if (i) sh.uniforms['tD' + i] = { value: t }; });
    nor.forEach((t, i) => { if (i) sh.uniforms['tN' + i] = { value: t }; });
    sh.uniforms.tiles = { value: LAYERS.map((l) => 1 / l.tile) };
    sh.uniforms.roughs = { value: LAYERS.map((l) => l.rough) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splatA; attribute vec2 splatB; varying vec4 vSplatA; varying vec2 vSplatB; varying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplatA = splatA; vSplatB = splatB; vWXZ = (modelMatrix * vec4(position, 1.)).xz;');
    const decl = LAYERS.map((_, i) => (i ? `uniform sampler2D tD${i}; uniform sampler2D tN${i};` : '')).join('\n');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${decl}
uniform float tiles[6]; uniform float roughs[6];
varying vec4 vSplatA; varying vec2 vSplatB; varying vec2 vWXZ;
float gW[6];
void splatWeights(vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5) {
  float w[6]; w[1] = vSplatA.x; w[2] = vSplatA.y; w[3] = vSplatA.z; w[4] = vSplatA.w; w[5] = vSplatB.x;
  w[0] = max(0., 1. - w[1] - w[2] - w[3] - w[4] - w[5]);
  vec3 cs[6]; cs[0] = c0; cs[1] = c1; cs[2] = c2; cs[3] = c3; cs[4] = c4; cs[5] = c5;
  float m = 0.; for (int i = 0; i < 6; i++) { gW[i] = w[i] + dot(cs[i], vec3(.3, .59, .11)) * .55 * step(.001, w[i]); m = max(m, gW[i]); }   // 밝기를 높이로
  float s = 0.; for (int i = 0; i < 6; i++) { gW[i] = max(gW[i] - (m - .3), 0.); s += gW[i]; }
  for (int i = 0; i < 6; i++) gW[i] /= max(s, 1e-4);
}`)
      .replace('#include <map_fragment>', `
vec2 tuv[6]; for (int i = 0; i < 6; i++) tuv[i] = vWXZ * tiles[i];
vec3 c0 = texture2D(map, tuv[0]).rgb, c1 = texture2D(tD1, tuv[1]).rgb, c2 = texture2D(tD2, tuv[2]).rgb, c3 = texture2D(tD3, tuv[3]).rgb, c4 = texture2D(tD4, tuv[4]).rgb, c5 = texture2D(tD5, tuv[5]).rgb;
c2 = mix(vec3(dot(c2, vec3(.3, .59, .11))), c2, .4) * vec3(1.02, 1., .95);   // 자갈: 붉은 기를 빼고 해변 모래 쪽 색으로
splatWeights(c0, c1, c2, c3, c4, c5);
vec3 albedo = c0 * gW[0] + c1 * gW[1] + c2 * gW[2] + c3 * gW[3] + c4 * gW[4] + c5 * gW[5];
// 큰 규모 얼룩으로 반복 무늬를 깬다
float macro = texture2D(tD2, vWXZ * .021).r * .55 + texture2D(tD3, vWXZ * .0071 + .3).g * .45;
albedo *= mix(.82, 1.12, macro);
diffuseColor.rgb *= albedo;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (roughs[0] * gW[0] + roughs[1] * gW[1] + roughs[2] * gW[2] + roughs[3] * gW[3] + roughs[4] * gW[4] + roughs[5] * gW[5]);`)
      .replace('#include <normal_fragment_maps>', `
vec3 nb = texture2D(normalMap, tuv[0]).xyz * gW[0] + texture2D(tN1, tuv[1]).xyz * gW[1] + texture2D(tN2, tuv[2]).xyz * gW[2] + texture2D(tN3, tuv[3]).xyz * gW[3] + texture2D(tN4, tuv[4]).xyz * gW[4] + texture2D(tN5, tuv[5]).xyz * gW[5];
vec3 mapN = nb * 2. - 1.; mapN.xy *= normalScale; normal = normalize(tbn * mapN);`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v2';   // 층 이름이 달라도 셰이더는 같다(텍스처만 다름)
  return mat;
}
