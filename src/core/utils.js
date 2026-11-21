// 공용 유틸리티 — 게임 로직과 그래픽 모듈이 함께 쓰는 순수 함수와 상수.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
/** ?debug 또는 ?selftest 로 열면 window.__game 디버그 API가 열리고 마우스 고정을 요구하지 않는다. */
export const DEBUG = params.has('debug') || params.has('selftest');
export const PARAMS = params;

export const V3 = THREE.Vector3;
export const $ = (id) => document.getElementById(id);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// 지형·소품 배치는 고정 시드 난수로 만든다(매번 같은 전장). 호출 순서가 바뀌면 배치가 달라지므로
// world.js(분화구) → EnvironmentManager.build() 순서를 유지할 것.
function mulberry(seed) { return () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const srand = mulberry(19440606);
export const sr = (a, b) => a + srand() * (b - a);

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
