export const controls = [
  { key: 'exposure', label: '노출', min: -3, max: 3, step: 0.05, unit: 'EV' },
  { key: 'contrast', label: '대비', min: 0, max: 2, step: 0.01, unit: '' },
  { key: 'saturation', label: '채도', min: 0, max: 2, step: 0.01, unit: '' },
  {
    key: 'temperature',
    label: '색온도',
    min: -1,
    max: 1,
    step: 0.01,
    unit: '',
  },
  { key: 'tint', label: '틴트', min: -1, max: 1, step: 0.01, unit: '' },
  { key: 'fade', label: '페이드', min: 0, max: 1, step: 0.01, unit: '' },
  { key: 'vignette', label: '비네팅', min: 0, max: 1, step: 0.01, unit: '' },
] as const;
export type FilterKey = (typeof controls)[number]['key'];
export type FilterSettings = Record<FilterKey, number>;
export const defaults: FilterSettings = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
};
export const presets = [
  { id: 'original', name: '기본', hint: 'Original', settings: { ...defaults } },
  {
    id: 'warm',
    name: '따뜻한',
    hint: 'Warm',
    settings: { ...defaults, temperature: 0.45, saturation: 0.9, fade: 0.08 },
  },
  {
    id: 'cool',
    name: '차가운',
    hint: 'Cool',
    settings: {
      ...defaults,
      temperature: -0.4,
      contrast: 1.08,
      saturation: 0.85,
    },
  },
  {
    id: 'faded',
    name: '페이드',
    hint: 'Faded',
    settings: { ...defaults, contrast: 0.88, saturation: 0.75, fade: 0.32 },
  },
  {
    id: 'mono',
    name: '흑백',
    hint: 'Mono',
    settings: { ...defaults, saturation: 0, contrast: 1.12 },
  },
];
export interface FilterRecipe {
  version: 1;
  pipeline: 'copycat-linear-v1';
  colorSpace: 'srgb';
  settings: FilterSettings;
}
export function recipe(settings: FilterSettings): FilterRecipe {
  return {
    version: 1,
    pipeline: 'copycat-linear-v1',
    colorSpace: 'srgb',
    settings: { ...settings },
  };
}
export function validateSettings(value: unknown): FilterSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('필터 옵션이 올바르지 않습니다.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== controls.length)
    throw new Error('필터 옵션의 개수가 맞지 않습니다.');
  const result = { ...defaults };
  for (const control of controls) {
    const v = input[control.key];
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < control.min ||
      v > control.max
    ) {
      throw new Error(
        `${control.label} 값은 ${control.min}~${control.max} 범위의 숫자여야 합니다.`,
      );
    }
    result[control.key] = v;
  }
  return result;
}
export function parseRecipe(text: string): FilterSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일을 읽을 수 없습니다.');
  }
  if (!value || typeof value !== 'object')
    throw new Error('필터 설정 파일이 아닙니다.');
  const r = value as Partial<FilterRecipe>;
  if (
    r.version !== 1 ||
    r.pipeline !== 'copycat-linear-v1' ||
    r.colorSpace !== 'srgb'
  ) {
    throw new Error('지원하지 않는 설정 버전 또는 색 공간입니다.');
  }
  return validateSettings(r.settings);
}
export function fitSize(
  width: number,
  height: number,
  maxEdge: number,
  maxPixels = Infinity,
) {
  const scale = Math.min(
    1,
    maxEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
