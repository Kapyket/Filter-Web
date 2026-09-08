import type { FilterSettings } from './settings';
export const decodeSRGB = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const encodeSRGB = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
export const clamp = (v: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, v));
/** Straight-alpha sRGB input/output; UV origin is the image's top left. */
export function filterPixel(
  rgba: readonly number[],
  uv: readonly number[],
  p: FilterSettings,
): number[] {
  let c = rgba
    .slice(0, 3)
    .map(decodeSRGB)
    .map((v) => v * 2 ** p.exposure);
  const gains = [
    2 ** (0.35 * p.temperature + 0.15 * p.tint),
    2 ** (-0.3 * p.tint),
    2 ** (-0.35 * p.temperature + 0.15 * p.tint),
  ];
  c = c.map((v, i) => (v * gains[i] - 0.18) * p.contrast + 0.18);
  const y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  c = c
    .map((v) => y + (v - y) * p.saturation)
    .map((v) => v * (1 - 0.5 * p.fade) + 0.18 * 0.5 * p.fade);
  const radius = Math.hypot(uv[0] * 2 - 1, uv[1] * 2 - 1) / Math.SQRT2;
  const t = clamp((radius - 0.25) / 0.75);
  const mask = 1 - p.vignette * t * t * (3 - 2 * t);
  return [...c.map((v) => encodeSRGB(clamp(v * mask))), rgba[3]];
}
