import { heicTo } from 'heic-to/next';
self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const bitmap = await heicTo({ blob: event.data, type: 'bitmap' });
    self.postMessage({ bitmap }, { transfer: [bitmap] });
  } catch {
    self.postMessage({
      error:
        'HEIC 변환에 실패했습니다. 지원하지 않는 코덱이거나 손상된 파일일 수 있습니다.',
    });
  }
};
