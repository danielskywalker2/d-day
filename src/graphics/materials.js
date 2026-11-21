// 재질 정의. 월드(M) · 1인칭 총기(VM) · 파편(DMAT) 세 묶음. 텍스처 파일은 AssetManager 가 불러온다.
import * as THREE from 'three';

export function createMaterials(assets) {
  const pbr = (...a) => assets.pbr(...a);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    concrete: S({ color: 0xd8d6cf, ...pbr('wood_textured_concrete') }),
    concreteDark: S({ color: 0x86847e, ...pbr('wood_textured_concrete') }),
    steel: S({ color: 0x2b2a28 }),
    rust: S({ color: 0x74665e, metalness: .35, ...pbr('rusty_metal_02', .5, 2) }),
    bag: S({ color: 0xd6c9a4, ...pbr('hessian_230', 2, 1) }),
    canvas: S({ color: 0x8f8763 }),
    boat: S({ color: 0x8f9da3, metalness: .4, ...pbr('metal_plate') }),
    tank: S({ color: 0xc9cfae, metalness: .3, ...pbr('green_metal_rust') }),
    wood: S({ color: 0x6b4526 }),
    woodDark: S({ color: 0x4a2e18 }),
    gun: S({ color: 0x1c1c1e }),
    od: S({ color: 0x5c5a3a }),
    odDark: S({ color: 0x46452c }),
    skin: S({ color: 0xc9a17e }),
    feld: S({ color: 0x5b6258 }),
    feldDark: S({ color: 0x3d423c }),
    helmet: S({ color: 0x2f3432 }),
    helmetUS: S({ color: 0x39402a }),
    boots: S({ color: 0x1a1816 }),
    white: S({ color: 0xe8e4d8 }),
    red: new THREE.MeshBasicMaterial({ color: 0xc8231c }),
    crate: S({ color: 0xa9b07c, ...pbr('weathered_planks') }),
  };
  const VM = {
    wood: S({ color: 0xc98a55, ...pbr('fine_grained_wood', 2.2, 2.2, Math.PI / 2) }),
    steel: S({ color: 0x3a3d42, roughness: 1, metalness: .9, roughnessMap: pbr('metal_plate', 4, 4).roughnessMap, normalMap: pbr('rusty_metal_02', 5, 5).normalMap, normalScale: new THREE.Vector2(.25, .25) }),
    dark: S({ color: 0x17181a, roughness: .5, metalness: .85 }),
    sleeve: S({ color: 0x6c6e44, ...pbr('hessian_230', 3, 3) }),
    skin: S({ color: 0xc79c7a, roughness: .75 }),
  };
  const DMAT = {
    blood: new THREE.MeshBasicMaterial({ color: 0x8a0d0a }), sand: S({ color: 0x7d6f52 }), dirt: S({ color: 0x4a4030 }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffd98a }), chip: S({ color: 0x9a9a92 }), water: new THREE.MeshBasicMaterial({ color: 0xc9d6dc }),
    brass: S({ color: 0xc9a03a, emissive: 0x3a2a00 }),
    // 6단계: 재질별 파편
    wood: S({ color: 0x8a6440 }), concrete: S({ color: 0xbdb8ad }), rock: S({ color: 0x5a5248 }),
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .55, .18).multiplyScalar(4) }),
  };
  return { M, VM, DMAT, all: [M, VM, DMAT] };
}
