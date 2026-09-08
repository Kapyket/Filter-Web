import {
  controls,
  recipe,
  validateSettings,
  type FilterSettings,
} from './settings';
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
}
export interface ModelContext {
  registerTool(
    tool: Tool,
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}
export function registerFilterTools(
  context: ModelContext | undefined,
  get: () => FilterSettings,
  set: (settings: FilterSettings) => void,
) {
  const lifecycle = new AbortController();
  if (!context?.registerTool) return () => lifecycle.abort();
  const tools: Tool[] = [
    {
      name: 'get_filter_recipe',
      description: '현재 보이는 필터 설정을 JSON으로 읽습니다.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => recipe(get()),
    },
    {
      name: 'set_filter_settings',
      description:
        '현재 사진의 색감 조정값 전체를 변경합니다. 파일 저장은 하지 않습니다.',
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          controls.map((c) => [
            c.key,
            { type: 'number', minimum: c.min, maximum: c.max },
          ]),
        ),
        required: controls.map((c) => c.key),
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const settings = validateSettings(input);
        set(settings);
        return recipe(settings);
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional browser API; the visible controls remain available. */
    }
  }
  return () => lifecycle.abort();
}
