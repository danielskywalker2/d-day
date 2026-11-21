# 사용한 외부 자료와 출처

## 3D 총기 모델

| 게임 내 용도 | 파일 | 원본 | 저작자 | 라이선스 | 수정 사항 |
|---|---|---|---|---|---|
| M1903A4 본체 | `assets/models/weapons/m1903a3.glb` | [M1903 A3 Springfield](https://gintoki1234.itch.io/springfield-m1903-a3) | Gintoki1234 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | FBX → GLB 변환, 텍스처 4K → 2K JPEG, 단위 cm → m, 총구가 −Z 를 향하도록 회전, 탄두·스트리퍼 클립 메시 제거. 게임 안에서 코드로 만든 스코프를 얹어 A4 형태로 사용 |
| M1 개런드 | `assets/models/weapons/m1_garand_violence.glb` | [Low poly weapon models](https://violencelat.itch.io/low-poly-weapon-models) | Emi @ Violence | CC0 (출처 표기 의무 없음) | 원본 그대로. 게임 안에서 재질을 실사 나무·강철 텍스처로 교체 |
| M1A1 톰슨 | `assets/models/weapons/thompson_violence.glb` | 위와 같음 | Emi @ Violence | CC0 | 위와 같음 |

**CC BY 4.0 출처 표기:** "M1903 A3 Springfield" by Gintoki1234 (https://gintoki1234.itch.io/springfield-m1903-a3), licensed under CC BY 4.0. 변환·축소·회전·부품 제거 등 수정함.

코드로 만든 모델(외부 파일 아님): M1897 트렌치건, M1903A4 의 스코프(Weaver 330C 형태), 손·팔, 탄피·클립·산탄.

## 병사 캐릭터·애니메이션 (Quaternius, CC0 — 출처 표기 의무 없음)

| 게임 내 용도 | 원본 | 수정 사항 |
|---|---|---|
| 병사 몸·의복·손 | [Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) (Standard) — Male_Peasant | 텍스처를 올리브드랩/필드그레이·갈색/검정 가죽으로 다시 칠함, 1K 로 축소 |
| 병사 머리 | [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) (Standard) — Superhero_Male | 목 위만 잘라 의상 뼈대에 연결 |
| 애니메이션 15종 | [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) (Standard) | 필요한 클립만 골라 이름 변경, 회전·골반 위치 트랙만 남김 |

결과 파일: `assets/models/characters/soldier_us.glb`, `soldier_de.glb`. 철모·군장·독일군 총(Kar98k·MP40)은 코드로 만든 것.

## 텍스처·하늘 (Poly Haven, CC0)

coast_sand_01, sparse_grass, wood_textured_concrete, rusty_metal_02, green_metal_rust, metal_plate, hessian_230, fine_grained_wood, weathered_planks, overcast_soil_puresky — https://polyhaven.com

4단계 지형·구조물 텍스처: damp_beach_sand(젖은 모래), brown_mud(진흙·흙 둔덕), rocky_gravel(자갈 둑), burned_ground_01(포탄 구덩이), cracked_concrete_wall(벙커·방파제) — 2K 대신 1K, 원본 그대로.

캠페인 Stage 2(생울타리) 텍스처: leafy_grass(들판), muddy_tracks(농로·마당), forest_leaves_02(흙둑·숲 바닥), rustic_stone_wall(농가·돌담), grey_roof_tiles(농가 지붕), roof_planks(헛간 지붕), bark_brown_02(나무 줄기) — 1K, 원본 그대로.

캠페인 Stage 3(코브라 작전) 텍스처: cobblestone_01(마을 돌길), damaged_plaster(무너진 집 바깥벽), plastered_stone_wall(집 안쪽 벽, 밝게 보정), brick_wall_001, brick_gravel(잔해 바닥·더미) — 1K, 원본 그대로.

캠페인 Stage 4(파리 해방) 텍스처: beige_wall_001(석회암 벽의 법선·거칠기 — 색은 코드로 그린 마름돌 무늬), stone_tiles_02(인도), wood_floor_worn(점령 건물 바닥), decrepit_wallpaper(점령 건물 안쪽 벽) — 1K, 원본 그대로. 돌길·잔해·지붕·나무 줄기는 Stage 2·3 에서 받은 것 재사용.

## 해변 소품 3D 모델 (Poly Haven, CC0)

| 게임 내 용도 | 원본 | 수정 사항 |
|---|---|---|
| 보급 상자(아이템) | [old_military_crate](https://polyhaven.com/a/old_military_crate) | 기존 상자 크기에 맞게 늘림 |
| 탄약 상자(아이템·흩어진 소품) | [ammo_box](https://polyhaven.com/a/ammo_box) | 없음 |
| 사대 모래주머니 | [cement_bag](https://polyhaven.com/a/cement_bag) | 형태만 빌려 모래주머니 재질로 반복 배치 |
| 흩어진 잔해 | [metal_jerrycan_green](https://polyhaven.com/a/metal_jerrycan_green), [barrel_03](https://polyhaven.com/a/barrel_03), [old_tyre](https://polyhaven.com/a/old_tyre), [rusted_wheel_rim_01](https://polyhaven.com/a/rusted_wheel_rim_01), [wooden_military_crate](https://polyhaven.com/a/wooden_military_crate) | 없음 |

| Stage 2 지휘소 탁자 | [dining_table](https://polyhaven.com/a/dining_table) | 크기에 맞게 늘림 |
| Stage 2 지휘소 무전기 | [vintage_radio_transceiver](https://polyhaven.com/a/vintage_radio_transceiver) | 없음 |
| Stage 4 가로등 | [street_lamp_02](https://polyhaven.com/a/street_lamp_02) | 높이 4.6m 로 맞춤, 인스턴스 LOD |
| Stage 4 카페·바리케이드·건물 안 의자 | [painted_wooden_chair_01](https://polyhaven.com/a/painted_wooden_chair_01) | 없음 |

1K glTF 판을 `assets/models/props/<이름>/` 에 그대로 둠.

Stage 2 의 생울타리(흙둑·덤불·잎 카드), 나무, 석조 농가·헛간·돌담, 박격포, 저격 망루, 수레, 건초 더미, 잎 무늬·작전 지도 텍스처는 코드로 만든 것(`src/stages/stage2/HedgerowEnvironment.js`).

Stage 3 의 무너진 집·성당·면사무소, 오펠 블리츠 트럭·Sd.Kfz.251 하프트랙·4호 전차 잔해, Pak 40 대전차포, 셔먼(1단계 코드 모델 재사용), 전신주, 부러진 나무는 코드로 만든 것(`src/stages/stage3/RuinedTownEnvironment.js`).

Stage 4 의 오스만식 건물(마름돌 무늬·창틀·연철 발코니 무늬·망사르 지붕), 점령 건물 내부, 구청, 상점 간판·차양·영화 포스터·삼색기 텍스처, 플라타너스, 모리스 기둥, 시트로엥 트락시옹 아방풍 승용차, 퀴벨바겐, 검문소 차단봉, 보도블록 바리케이드는 코드로 만든 것(`src/stages/stage4/ParisEnvironment.js`). 레지스탕스(베레모·완장)와 민간인(사복 색)은 기존 Quaternius 병사 모델의 색을 바꾼 것. 해방 장면의 교회 종소리는 합성음(`src/game/audio.js` 의 `bell`).

Stage 5 의 가문비나무·너도밤나무(바늘잎·단풍잎 무늬), 용의 이빨, 지하 지휘 벙커(경사로·옹벽·방·2층 침대·전등), 관측 요새, 나무 위 저격대, 박격포, Sd.Kfz.251 하프트랙·오펠 블리츠 트럭, 작전 지도·지뢰 경고판 텍스처, 멀리 보이는 독일 쪽 구릉과 마을은 코드로 만든 것(`src/stages/stage5/BorderEnvironment.js`). 지크프리트선 벙커·체코 고슴도치·철조망·참호 판자벽·MG42·불탄 셔먼은 기존 `PropBuilder.js` 재사용. Stage 5 는 새로 받은 파일 없이 기존 텍스처(cracked_concrete_wall, wood_textured_concrete, forest_leaves_02, leafy_grass, sparse_grass, brown_mud, rocky_gravel, burned_ground_01, bark_brown_02, weathered_planks)와 모델(탁자·무전기·의자·상자·탄약통·모래주머니)만 사용.

코드로 만든 구조물(외부 파일 아님, `src/graphics/PropBuilder.js`): 체코 고슴도치, 철조망, 방파제, MG42 벙커와 흙 둔덕, MG42, 파괴된 셔먼 전차, 히긴스 상륙정, 참호 판자벽.

## 소리

### 총성 녹음 — The Free Firearm Sound Library (CC0)

"The Free Firearm Sound Library" by Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney — CC0 1.0 (권리 포기, 출처 표기 의무 없음).
원본: https://opengameart.org/content/the-free-firearm-sound-library · 받은 곳: GitHub 미러 `buddingmonkey/FreeFirearmsSFXLibrary` (Prepared SFX).

| 게임 내 용도 | 녹음된 총 (파일) | 수정 사항 |
|---|---|---|
| M1 개런드 `garand_1·2` | Springfield M1917, .30-06 (B_24P, 근거리) | 한 발씩 잘라 냄, 48kHz AAC, 피크 −1dB |
| M1903A4 `springfield_1·2` | Arisaka 볼트액션 (E_25P, 근거리) | 같음 |
| M1A1 톰슨 `thompson_1·2·3` | Carl Gustav M45, 9mm 기관단총 (G_31P, 근거리) | 같음. 게임에서 0.93배 속도로 낮춰 재생 |
| M1897 트렌치건 `trench_1·2` | Winchester Model 12 펌프 산탄총 (K_22P, 근거리) | 같음 |
| MG42 `mg42_1·2·3` | AK-47 단발 (C_28P, 근거리) | 모노, 0.5초로 짧게. 게임에서 0.9배 속도·0.05초 간격으로 겹쳐 분당 1,200발 소리를 만든다 |
| MP40 `mp40_1·2` | Carl Gustav M45 (G_20P, 중거리) | 모노 |
| Kar98k `kar98k_1·2` | Mosin-Nagant (M_26P, 중거리) | 모노 |

라이브러리에 개런드·톰슨·M1897·MG42 녹음이 없어서, 같은 탄약이거나 같은 작동 방식인 가장 가까운 총의 실제 녹음을 썼다.

### 합성음

시네마틱 배경 음악 3곡(tense·somber·triumph: 현악 화음·팀파니·작은북·선율)과 무전 잡음은 Web Audio 로 합성(`src/game/audio.js` 의 `music`·`radio`). 외부 음원 없음.

폭발·탄착(재질별)·장전·볼트·펌프·발소리·피격음 등 나머지 효과음은 Web Audio API 로 코드에서 합성한다(`src/game/audio.js`).

## 라이브러리

three.js r160 (MIT) — https://threejs.org · fflate (MIT, FBX 변환 도구에서만 사용)
