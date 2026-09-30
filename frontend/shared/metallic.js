export const METALLIC_GOLD = '#FFD700';

// A restrained foil-like gradient contained inside the original stroke width.
// Test and older canvas shims safely fall back to the installation gold.
export function metallicGold(ctx, size = 140) {
  if (typeof ctx?.createLinearGradient !== 'function') return METALLIC_GOLD;
  const gradient = ctx.createLinearGradient(0, 0, size, size * .72);
  gradient.addColorStop(0, '#9B6A00');
  gradient.addColorStop(.18, '#E5AE00');
  gradient.addColorStop(.38, '#FFF2A6');
  gradient.addColorStop(.52, '#FFD700');
  gradient.addColorStop(.72, '#B77B00');
  gradient.addColorStop(.88, '#FFE76A');
  gradient.addColorStop(1, '#C88D00');
  return gradient;
}

export function paintMetallicMask(ctx, mask, size = 140, phase = 0) {
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(mask, 0, 0, size, size);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = metallicGold(ctx, size);
  ctx.fillRect(0, 0, size, size);

  if (typeof ctx.createLinearGradient === 'function') {
    const travel = (((phase % 1) + 1) % 1) * size * 2.4 - size * .7;
    const shine = ctx.createLinearGradient(travel - size * .34, size, travel + size * .34, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(.38, 'rgba(255,248,202,0)');
    shine.addColorStop(.49, 'rgba(255,255,255,.88)');
    shine.addColorStop(.54, 'rgba(255,249,208,.42)');
    shine.addColorStop(.66, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}
