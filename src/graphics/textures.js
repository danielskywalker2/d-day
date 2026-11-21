// 코드로 그리는 절차적 텍스처(연기·총구 섬광·풀잎). 파일이 필요 없어 로딩 실패가 없다.
import * as THREE from 'three';

function canvasTex(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

export function createProceduralTextures() {
  const smoke = canvasTex(64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.5, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  const flash = canvasTex(128, (g, s) => {
    const c = s / 2; g.translate(c, c);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, c); r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(.25, 'rgba(255,210,110,.9)'); r.addColorStop(.6, 'rgba(255,120,30,.35)'); r.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = r; g.beginPath(); g.arc(0, 0, c, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,240,190,.9)';
    for (let i = 0; i < 7; i++) { g.rotate(Math.PI * 2 / 7 + Math.random() * .3); g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -c * (0.6 + Math.random() * .4)); g.lineTo(4, 0); g.fill(); }
  });
  const grass = canvasTex(64, (g, s) => { g.clearRect(0, 0, s, s); for (let i = 0; i < 22; i++) { const x = 6 + Math.random() * (s - 12), h = s * (.45 + Math.random() * .55), lean = (Math.random() - .5) * 20, v = 150 + Math.random() * 105 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.moveTo(x - 2.2, s); g.quadraticCurveTo(x + lean * .3, s - h * .5, x + lean, s - h); g.quadraticCurveTo(x + lean * .4 + 1.5, s - h * .5, x + 2.2, s); g.fill(); } });
  return { smoke, flash, grass };
}
