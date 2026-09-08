import vectors from '../docs/reference-vectors.json';
import { describe, it, expect } from 'vitest';
import {
  controls,
  defaults,
  presets,
  recipe,
  parseRecipe,
  fitSize,
} from '../lib/filter/settings';
import { filterPixel, decodeSRGB, encodeSRGB } from '../lib/filter/reference';
import { detectKind } from '../lib/filter/images';

describe('portable color pipeline', () => {
  it('matches the frozen iOS reference vectors', () => {
    for (const vector of vectors.vectors) {
      const actual = filterPixel(vector.rgba, vector.uv, vector.settings);
      actual.forEach((v, i) => expect(v).toBeCloseTo(vector.expected[i], 10));
    }
  });
  it('preserves all 256 channel values and straight alpha at neutral settings', () => {
    for (let value = 0; value < 256; value++) {
      const p = [value / 255, (255 - value) / 255, 0.25, 0.4];
      const out = filterPixel(p, [0.05, 0.97], defaults);
      p.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 10));
    }
  });
  it('exposure +1 doubles linear light', () => {
    const out = filterPixel([0.2, 0.3, 0.4, 1], [0.5, 0.5], {
      ...defaults,
      exposure: 1,
    });
    expect(decodeSRGB(out[1])).toBeCloseTo(decodeSRGB(0.3) * 2, 10);
  });
  it('contrast pivots on linear 0.18', () => {
    const grey = encodeSRGB(0.18);
    expect(
      filterPixel([grey, grey, grey, 1], [0.5, 0.5], {
        ...defaults,
        contrast: 2,
      })[0],
    ).toBeCloseTo(grey, 10);
  });
  it('monochrome uses Rec.709 linear luminance', () => {
    const out = filterPixel([1, 0, 0, 0.5], [0.5, 0.5], {
      ...defaults,
      saturation: 0,
    });
    expect(out).toEqual([
      encodeSRGB(0.2126),
      encodeSRGB(0.2126),
      encodeSRGB(0.2126),
      0.5,
    ]);
  });
  it('vignette is resolution-independent and leaves the center unchanged', () => {
    const input = [0.7, 0.6, 0.5, 0.25];
    const p = { ...defaults, vignette: 1 };
    expect(filterPixel(input, [0, 0], p)).toEqual([0, 0, 0, 0.25]);
    filterPixel(input, [0.5, 0.5], p).forEach((v, i) =>
      expect(v).toBeCloseTo(input[i], 10),
    );
    expect(filterPixel(input, [0.1, 0.25], p)).toEqual(
      filterPixel(input, [100 / 1000, 250 / 1000], p),
    );
  });
  it('all extreme settings and presets stay finite, bounded, and preserve alpha', () => {
    for (const c of controls)
      for (const v of [c.min, c.max]) {
        for (const p of [defaults, ...presets.map((p) => p.settings)]) {
          const out = filterPixel([0, 0.5, 1, 0.3], [0, 1], {
            ...p,
            [c.key]: v,
          });
          out.forEach((value) => {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          });
          expect(out[3]).toBe(0.3);
        }
      }
  });
});
describe('recipe import', () => {
  it('round trips all presets without rounding', () => {
    for (const p of presets)
      expect(parseRecipe(JSON.stringify(recipe(p.settings)))).toEqual(
        p.settings,
      );
  });
  it('rejects malformed, missing, unknown, out-of-range and nonfinite values', () => {
    for (const raw of [
      'null',
      '[]',
      '{broken',
      '{}',
      JSON.stringify({ ...recipe(defaults), version: 2 }),
      JSON.stringify({ ...recipe(defaults), colorSpace: 'display-p3' }),
      JSON.stringify({ ...recipe(defaults), pipeline: 'unknown' }),
    ])
      expect(() => parseRecipe(raw)).toThrow();
    for (const v of [-4, 4, null, '1', Infinity])
      expect(() =>
        parseRecipe(
          JSON.stringify(recipe({ ...defaults, exposure: v as number })),
        ),
      ).toThrow();
    expect(() =>
      parseRecipe(
        JSON.stringify({
          ...recipe(defaults),
          settings: { ...defaults, unknown: 1 },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRecipe(
        JSON.stringify({ ...recipe(defaults), settings: { exposure: 0 } }),
      ),
    ).toThrow();
  });
});
describe('image bounds and file signatures', () => {
  it('fits previews and 48MP exports without changing aspect ratio beyond integer rounding', () => {
    expect(fitSize(8000, 6000, 2048)).toEqual({ width: 2048, height: 1536 });
    const size = fitSize(8000, 6000, 16384, 24_000_000);
    expect(size.width * size.height).toBeLessThanOrEqual(24_000_000);
    expect(size.width / size.height).toBeCloseTo(4 / 3, 3);
    expect(fitSize(100, 50, 2048)).toEqual({ width: 100, height: 50 });
  });
  it('checks bytes rather than trusting an extension', async () => {
    expect(
      await detectKind(new Blob([new Uint8Array([255, 216, 255, 0])])),
    ).toBe('JPEG');
    expect(
      await detectKind(new Blob([new Uint8Array([137, 80, 78, 71])])),
    ).toBe('PNG');
    expect(await detectKind(new Blob(['RIFF0000WEBP']))).toBe('WebP');
    expect(await detectKind(new Blob(['0000ftypheic']))).toBe('HEIC');
    await expect(
      detectKind(new Blob(['not an image'], { type: 'image/png' })),
    ).rejects.toThrow();
  });
});
