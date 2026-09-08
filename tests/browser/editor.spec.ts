import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults, recipe, presets, controls } from '../../lib/filter/settings';
import { filterPixel } from '../../lib/filter/reference';
const fixture = (name: string) => `tests/fixtures/${name}`;

test('loads Astryx controls, edits, exports, imports and rejects invalid recipes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await expect(
    page.getByRole('button', { name: '사진 선택하기', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(7);
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles(fixture('colors.png'));
  const save = page.getByRole('button', {
    name: '보정 이미지 저장',
    exact: true,
  });
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: '따뜻한', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '따뜻한', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('노출 값', { exact: true }).fill('0.75');
  await page.getByLabel('노출 값', { exact: true }).press('Enter');
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 저장', exact: true }).click();
  const json = JSON.parse(
    await readFile((await (await jsonDownload).path())!, 'utf8'),
  );
  expect(json.settings.exposure).toBe(0.75);
  expect(json.pipeline).toBe('copycat-linear-v1');
  await page.getByRole('button', { name: '전체 초기화', exact: true }).click();
  await page
    .getByLabel('필터 JSON 선택')
    .setInputFiles({
      name: 'preset.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(json)),
    });
  await expect(page.getByLabel('노출 값', { exact: true })).toHaveValue('0.75');
  await page
    .getByLabel('필터 JSON 선택')
    .setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...json, version: 9 })),
    });
  await expect(page.locator('.feedback [role=alert]')).toContainText(
    '지원하지 않는',
  );
  await expect(page.getByLabel('노출 값', { exact: true })).toHaveValue('0.75');
  const imageDownload = page.waitForEvent('download');
  await save.click();
  const result = await imageDownload;
  expect(result.suggestedFilename()).toBe('colors-copycat.png');
  expect((await readFile((await result.path())!)).byteLength).toBeGreaterThan(
    200,
  );
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('GPU output matches CPU formulas for every control, presets, alpha and neutral pixels', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  const variants = [
    defaults,
    ...presets.map((p) => p.settings),
    ...controls.flatMap((c) =>
      [c.min, c.max].map((value) => ({ ...defaults, [c.key]: value })),
    ),
  ];
  const samples = [
    [255, 32, 32, 255],
    [32, 255, 32, 255],
    [32, 32, 255, 255],
    [128, 128, 128, 128],
  ];
  const actual = await page.evaluate(
    async ({ variants, samples }) => {
      const moduleUrl = '/lib/filter/renderer.ts';
      const { FilterRenderer } = await import(moduleUrl);
      const input = document.createElement('canvas');
      input.width = 2;
      input.height = 2;
      input
        .getContext('2d')!
        .putImageData(
          new ImageData(new Uint8ClampedArray(samples.flat()), 2, 2),
          0,
          0,
        );
      const renderer = new FilterRenderer(document.createElement('canvas'));
      renderer.setSource(input);
      const outputs = variants.map((p) => {
        renderer.render(p);
        const pixels = new Uint8Array(16);
        renderer.gl.readPixels(
          0,
          0,
          2,
          2,
          renderer.gl.RGBA,
          renderer.gl.UNSIGNED_BYTE,
          pixels,
        );
        return [...pixels.slice(8), ...pixels.slice(0, 8)];
      });
      renderer.dispose(true);
      return outputs;
    },
    { variants, samples },
  );
  for (let variant = 0; variant < variants.length; variant++)
    for (let pixel = 0; pixel < samples.length; pixel++) {
      const expected = filterPixel(
        samples[pixel].map((v) => v / 255),
        [((pixel % 2) + 0.5) / 2, (Math.floor(pixel / 2) + 0.5) / 2],
        variants[variant],
      );
      expected.forEach((v, channel) =>
        expect(
          Math.abs(actual[variant][pixel * 4 + channel] - Math.round(v * 255)),
        ).toBeLessThanOrEqual(1),
      );
    }
});

test('EXIF orientation, repeated file replacement, WebP and corrupt images', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  const input = page.getByLabel('이미지 파일 선택');
  await input.setInputFiles(fixture('portrait-exif.jpg'));
  await expect(
    page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.file-meta')).toContainText('160 × 240');
  for (const name of ['colors.webp', 'colors.png', 'colors.png']) {
    await input.setInputFiles(fixture(name));
    await expect(page.locator('.file-meta')).toContainText(name);
    await expect(
      page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.feedback [role=alert]')).toHaveCount(0);
  }
  await input.setInputFiles(fixture('broken.png'));
  await expect(page.locator('.feedback [role=alert]')).toContainText(
    '이미지를 읽을 수 없습니다',
  );
  await expect(page.locator('.file-meta')).toContainText('colors.png');
});

test('HEIC decodes locally and exports an SDR image', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith('http://127.0.0.1:3000')
    )
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles(fixture('colors.heic'));
  await expect(
    page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('.file-meta')).toContainText('HEIC');
  await expect(page.locator('.image-notice')).toContainText('8비트 SDR');
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '보정 이미지 저장', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('colors-copycat.png');
  expect(external).toEqual([]);
});

test('PNG preserves transparency and JPEG flattens on white; exports ignore compare position', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles(fixture('colors.png'));
  const save = page.getByRole('button', {
    name: '보정 이미지 저장',
    exact: true,
  });
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: '흑백', exact: true }).click();
  for (const format of ['PNG', 'JPEG']) {
    await page.getByRole('button', { name: format, exact: true }).click();
    const pending = page.waitForEvent('download');
    await save.click();
    const bytes = await readFile((await (await pending).path())!);
    const result = await page.evaluate(async (base64) => {
      const blob = new Blob([
        Uint8Array.from(atob(base64), (v) => v.charCodeAt(0)),
      ]);
      const bitmap = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: c.width,
        height: c.height,
        transparent: [...ctx.getImageData(230, 150, 1, 1).data],
        colored: [...ctx.getImageData(20, 20, 1, 1).data],
      };
    }, bytes.toString('base64'));
    expect(result.width).toBe(240);
    expect(result.height).toBe(160);
    expect(result.transparent).toEqual(
      format === 'PNG' ? [0, 0, 0, 0] : [255, 255, 255, 255],
    );
    expect(Math.abs(result.colored[0] - result.colored[1])).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(result.colored[1] - result.colored[2])).toBeLessThanOrEqual(
      1,
    );
  }
});

test('limited GPU offers explicit reduced export and unavailable GPU gives useful error', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the original receiver below
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (name: number) {
      if (name === this.MAX_TEXTURE_SIZE) return 128;
      return original.call(this, name);
    };
  });
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles(fixture('colors.png'));
  // A device smaller than the preview itself must report failure, not save an empty frame.
  await expect(page.locator('.feedback [role=alert]')).toContainText(
    'GPU 처리 한도',
  );
  await expect(
    page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
  ).toBeDisabled();
});

test('optional WebMCP tools change the same controls and reject invalid input', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, { execute: (input: unknown) => unknown }> = {};
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool(
          tool: { name: string; execute: (input: unknown) => unknown },
          { signal }: { signal: AbortSignal },
        ) {
          tools[tool.name] = tool;
          signal.addEventListener('abort', () => delete tools[tool.name]);
        },
      },
    });
    Object.assign(window, { filterTools: tools });
  });
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await expect(
    page.getByRole('button', { name: '사진 선택하기', exact: true }),
  ).toBeVisible();
  const result = await page.evaluate(
    (settings) => {
      const tools = (
        window as unknown as {
          filterTools: Record<string, { execute: (value: unknown) => unknown }>;
        }
      ).filterTools;
      tools.set_filter_settings.execute(settings);
      try {
        tools.set_filter_settings.execute({ exposure: 500 });
      } catch {
        /* Expected validation failure. */
      }
      return tools.get_filter_recipe.execute({});
    },
    { ...defaults, exposure: 1.25 },
  );
  expect(result).toEqual(recipe({ ...defaults, exposure: 1.25 }));
  await expect(page.getByLabel('노출 값', { exact: true })).toHaveValue('1.25');
});

test('large images require explicit resized export, with announced dimensions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- explicitly invoked with receiver
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (name: number) {
      return name === this.MAX_TEXTURE_SIZE ? 2048 : original.call(this, name);
    };
  });
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 4096;
    c.height = 3072;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#708050';
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles({
      name: 'large.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
  await expect(page.locator('.file-meta')).toContainText('4,096 × 3,072');
  const consent = page.getByRole('switch', { name: '2048 × 1536로 축소 저장' });
  await expect(consent).toBeVisible();
  const save = page.getByRole('button', {
    name: '보정 이미지 저장',
    exact: true,
  });
  await expect(save).toBeDisabled();
  await consent.check();
  await expect(save).toBeEnabled();
  const pending = page.waitForEvent('download');
  await save.click();
  const bytes = await readFile((await (await pending).path())!);
  // PNG IHDR width/height.
  expect(bytes.readUInt32BE(16)).toBe(2048);
  expect(bytes.readUInt32BE(20)).toBe(1536);
});

test('missing WebGL2 disables image export with a Korean recovery message', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- explicitly invoked with receiver
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (type: string, ...args: unknown[]) {
        return type === 'webgl2'
          ? null
          : Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  await page
    .getByLabel('이미지 파일 선택')
    .setInputFiles(fixture('colors.png'));
  await expect(page.locator('.feedback [role=alert]')).toContainText(
    'WebGL2를 사용할 수 없습니다',
  );
  await expect(
    page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
  ).toBeDisabled();
});

test('new image wins over pending HEIC conversion; narrow layouts keep controls accessible', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.studio')).toHaveAttribute('data-ready', 'true');
  const input = page.getByLabel('이미지 파일 선택');
  await input.setInputFiles(fixture('colors.heic'));
  await input.setInputFiles(fixture('colors.png'));
  await expect(page.locator('.file-meta')).toContainText('colors.png');
  await expect(
    page.getByRole('button', { name: '보정 이미지 저장', exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(
    page.getByRole('button', { name: '사진 선택하기', exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '흑백', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '흑백', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});
