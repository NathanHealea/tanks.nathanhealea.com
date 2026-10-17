import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: number): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.25 + Math.random() * 0.4;
    ctx.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 1, size * Math.random() + 1);
  }
  ctx.globalAlpha = 1;
}

/** Light plank floor; one texture tile covers 4x4 world units. */
export function makeFloorTexture(): CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const plank = size / 6;
  for (let i = 0; i < 6; i++) {
    const l = 66 + Math.random() * 6;
    ctx.fillStyle = `hsl(34 38% ${l}%)`;
    ctx.fillRect(0, i * plank, size, plank);
    for (let g = 0; g < 14; g++) {
      ctx.strokeStyle = `hsla(30 35% ${l - 12}% / ${0.12 + Math.random() * 0.15})`;
      ctx.lineWidth = 1 + Math.random() * 1.5;
      ctx.beginPath();
      const y = i * plank + Math.random() * plank;
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + g) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'hsla(30 30% 35% / 0.5)';
    ctx.fillRect(0, i * plank, size, 2);
    const seam = ((i * 197) % size) + 40;
    ctx.fillRect(seam, i * plank, 2, plank);
  }
  return finish(c, true);
}

export function makeBlockTexture(): CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#d9c7a3';
  ctx.fillRect(0, 0, size, size);
  for (let g = 0; g < 10; g++) {
    ctx.strokeStyle = `rgba(150,115,70,${0.12 + Math.random() * 0.12})`;
    ctx.beginPath();
    const y = Math.random() * size;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(40, y + 6, 80, y - 6, size, y + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(110,80,45,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  return finish(c);
}

export function makeCorkTexture(): CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#b8895a';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 900, ['#8a5f37', '#d3a875', '#6e4a2a'], 3);
  ctx.strokeStyle = 'rgba(90,60,30,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  return finish(c);
}

export function makePopMarkTexture(): CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  ctx.strokeStyle = 'rgba(40,30,25,0.55)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(28, 28);
  ctx.lineTo(100, 100);
  ctx.moveTo(100, 28);
  ctx.lineTo(28, 100);
  ctx.stroke();
  return finish(c);
}
