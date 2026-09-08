// eslint-disable-next-line import/default -- Vite supplies the default Worker constructor for ?worker imports.
import HeicWorker from './heic.worker?worker';
import { fitSize } from './settings';
export interface LoadedImage {
  id: string;
  bitmap: ImageBitmap;
  preview: HTMLCanvasElement;
  name: string;
  kind: string;
  notice: string;
}
export const MAX_EXPORT_PIXELS = 24_000_000;
export function normalizeImage(
  bitmap: ImageBitmap,
  width: number,
  height: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('이미지 메모리를 할당할 수 없습니다.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}
function convertHeic(file: Blob, signal: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const worker = new HeicWorker();
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('취소됨', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'HEIC 변환 시간이 초과되었습니다. 작은 이미지로 다시 시도해 주세요.',
        ),
      );
    }, 90_000);
    worker.onmessage = (
      event: MessageEvent<{ bitmap?: ImageBitmap; error?: string }>,
    ) => {
      cleanup();
      if (event.data.bitmap) resolve(event.data.bitmap);
      else reject(new Error(event.data.error || 'HEIC 변환에 실패했습니다.'));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('HEIC 변환기를 실행할 수 없습니다.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.postMessage(file);
  });
}
export async function detectKind(file: Blob) {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = new TextDecoder('ascii').decode(b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  if (b[0] === 137 && ascii.slice(1, 4) === 'PNG') return 'PNG';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'WebP';
  if (
    ascii.slice(4, 8) === 'ftyp' &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(ascii.slice(8))
  )
    return 'HEIC';
  throw new Error('JPEG, PNG, WebP 또는 HEIC 이미지 파일을 선택해 주세요.');
}
export async function loadImage(
  file: File,
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<LoadedImage> {
  if (file.size > 80 * 1024 * 1024)
    throw new Error('80MB 이하의 이미지를 선택해 주세요.');
  const kind = await detectKind(file);
  signal.throwIfAborted();
  status(
    kind === 'HEIC'
      ? 'HEIC 사진을 SDR 미리보기로 변환하고 있습니다…'
      : '이미지를 불러오고 있습니다…',
  );
  let bitmap: ImageBitmap;
  try {
    bitmap =
      kind === 'HEIC'
        ? await convertHeic(file, signal)
        : await createImageBitmap(file, {
            imageOrientation: 'from-image',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'default',
          });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || kind === 'HEIC')
    )
      throw error;
    throw new Error(
      '이미지를 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.',
    );
  }
  try {
    signal.throwIfAborted();
    if (bitmap.width * bitmap.height > 80_000_000)
      throw new Error('8천만 픽셀 이하의 이미지를 선택해 주세요.');
    const size = fitSize(bitmap.width, bitmap.height, 2048);
    const preview = normalizeImage(bitmap, size.width, size.height);
    return {
      id: crypto.randomUUID(),
      bitmap,
      preview,
      name: file.name,
      kind,
      notice:
        kind === 'HEIC'
          ? 'HEIC의 첫 정지 이미지를 8비트 SDR로 표시합니다. HDR·광색역 색감은 사진 앱과 다를 수 있습니다.'
          : '',
    };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
export function releaseImage(image: LoadedImage | null) {
  if (!image) return;
  image.bitmap.close();
  image.preview.width = 1;
  image.preview.height = 1;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                '이미지를 저장할 수 없습니다. 축소 저장을 시도해 주세요.',
              ),
            ),
      type,
      0.95,
    );
  });
}
