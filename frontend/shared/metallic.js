export const METALLIC_GOLD = '#E7BD00';

// Stay close to #FFD700: slightly deeper yellow, with moving pale-gold reflections.
// Draw, SVG, LED and Control use this same artwork-local gold palette.
// Only presentation adds the moving reflection; alpha and geometry stay intact.
export function metallicStops(color = METALLIC_GOLD) {
  const gold = [[0,'#A77D16'],[.18,'#C49A0B'],[.38,'#F4D84F'],[.52,METALLIC_GOLD],[.72,'#B58B08'],[.88,'#F8DC63'],[1,'#C49A0B']];
  if (!/^#[\da-f]{6}$/i.test(color) || color.toUpperCase() === METALLIC_GOLD) return gold;
  const channels = color.slice(1).match(/../g).map(value => parseInt(value,16));
  // Same artwork-local reflection profile for every ink; no alpha/width change.
  return [[0,-.30],[.18,-.15],[.38,.32],[.52,0],[.72,-.22],[.88,.45],[1,-.15]].map(([offset,mix]) =>
    [offset,'#'+channels.map(value => Math.round(mix < 0 ? value*(1+mix) : value+(255-value)*mix).toString(16).padStart(2,'0')).join('').toUpperCase()]);
}

export function metallicGold(ctx, size = 140, color = METALLIC_GOLD) {
  if (typeof ctx?.createLinearGradient !== 'function') return /^#[\da-f]{6}$/i.test(color) ? color.toUpperCase() : METALLIC_GOLD;
  const gradient = ctx.createLinearGradient(0, 0, size, size * .72);
  for (const [offset,ink] of metallicStops(color)) gradient.addColorStop(offset,ink);
  return gradient;
}

export function paintMetallicMask(ctx, mask, size = 140, phase = 0, preserveColor = false) {
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(mask, 0, 0, size, size);
  if (!preserveColor) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = metallicGold(ctx, size);
    ctx.fillRect(0, 0, size, size);
  }

  if (typeof ctx.createLinearGradient === 'function') {
    const travel = (((phase % 1) + 1) % 1) * size * 2.4 - size * .7;
    const shine = ctx.createLinearGradient(travel - size * .34, size, travel + size * .34, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(.25, 'rgba(129,85,7,0)');
    shine.addColorStop(.38, preserveColor ? 'rgba(0,0,0,.32)' : 'rgba(129,85,7,.32)');
    shine.addColorStop(.44, 'rgba(255,247,190,0)');
    shine.addColorStop(.49, preserveColor ? 'rgba(255,255,255,.78)' : 'rgba(255,247,190,.78)');
    shine.addColorStop(.54, preserveColor ? 'rgba(255,255,255,.42)' : 'rgba(255,232,110,.42)');
    shine.addColorStop(.66, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}
