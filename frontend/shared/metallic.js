export const METALLIC_GOLD = '#E7BD00';

// Stay close to #FFD700: slightly deeper yellow, with moving pale-gold reflections.
// Draw, SVG, LED and Control use this same artwork-local gold palette.
// Only presentation adds the moving reflection; alpha and geometry stay intact.
export function metallicGold(ctx, size = 140) {
  if (typeof ctx?.createLinearGradient !== 'function') return METALLIC_GOLD;
  const gradient = ctx.createLinearGradient(0, 0, size, size * .72);
  gradient.addColorStop(0, '#A77D16');
  gradient.addColorStop(.18, '#C49A0B');
  gradient.addColorStop(.38, '#F4D84F');
  gradient.addColorStop(.52, METALLIC_GOLD);
  gradient.addColorStop(.72, '#B58B08');
  gradient.addColorStop(.88, '#F8DC63');
  gradient.addColorStop(1, '#C49A0B');
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
    shine.addColorStop(.25, 'rgba(129,85,7,0)');
    shine.addColorStop(.38, 'rgba(129,85,7,.32)');
    shine.addColorStop(.44, 'rgba(255,247,190,0)');
    shine.addColorStop(.49, 'rgba(255,247,190,.78)');
    shine.addColorStop(.54, 'rgba(255,232,110,.42)');
    shine.addColorStop(.66, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}
