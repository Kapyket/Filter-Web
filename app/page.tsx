'use client';
import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { registerFilterTools, type ModelContext } from '../lib/filter/webmcp';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Button } from '@astryxdesign/core/Button';
import { Slider } from '@astryxdesign/core/Slider';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import {
  Aperture,
  Upload,
  ImagePlus,
  RotateCcw,
  SlidersHorizontal,
  ArrowDownToLine,
  FileJson,
  Check,
  ArrowLeftRight,
} from 'lucide-react';
import {
  controls,
  defaults,
  presets,
  recipe,
  parseRecipe,
  fitSize,
  type FilterSettings,
  type FilterKey,
} from '../lib/filter/settings';
import { FilterRenderer } from '../lib/filter/renderer';
import {
  loadImage,
  releaseImage,
  normalizeImage,
  download,
  canvasBlob,
  MAX_EXPORT_PIXELS,
  type LoadedImage,
} from '../lib/filter/images';

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : '처리에 실패했습니다. 다시 시도해 주세요.';
const subscribeReady = () => () => {};
export default function Home() {
  const ready = useSyncExternalStore(
    subscribeReady,
    () => true,
    () => false,
  );
  const [settings, setSettings] = useState<FilterSettings>({ ...defaults });
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [compare, setCompare] = useState(true);
  const [split, setSplit] = useState(50);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [maxEdge, setMaxEdge] = useState(4096);
  const [allowReduced, setAllowReduced] = useState(false);
  const [gpuReady, setGpuReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 400 });
  const renderer = useRef<FilterRenderer | null>(null);
  const currentImage = useRef<LoadedImage | null>(null);
  const request = useRef<AbortController | null>(null);
  const exportLock = useRef(false);
  const latestSettings = useRef(settings);
  useEffect(() => {
    latestSettings.current = settings;
  }, [settings]);
  useEffect(
    () =>
      registerFilterTools(
        (document as Document & { modelContext?: ModelContext }).modelContext,
        () => latestSettings.current,
        (next) => {
          flushSync(() => setSettings(next));
          latestSettings.current = next;
        },
      ),
    [],
  );
  const activePreset = presets.find((p) =>
    controls.every((c) => p.settings[c.key] === settings[c.key]),
  );

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      request.current?.abort();
      releaseImage(currentImage.current);
    },
    [],
  );
  useEffect(() => {
    if (!image || !canvas.current) return;
    let next: FilterRenderer | null = null;
    const target = canvas.current;
    const lost = (event: Event) => {
      event.preventDefault();
      setGpuReady(false);
      setError('GPU 연결이 끊겼습니다. 이미지를 다시 불러와 주세요.');
    };
    target.addEventListener('webglcontextlost', lost);
    const frame = requestAnimationFrame(() => {
      try {
        next = new FilterRenderer(target);
        next.setSource(image.preview);
        renderer.current = next;
        setMaxEdge(next.maxEdge);
        setGpuReady(true);
      } catch (e) {
        setError(messageOf(e));
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('webglcontextlost', lost);
      next?.dispose();
      renderer.current = null;
    };
  }, [image]);
  useEffect(() => {
    if (!gpuReady) return;
    const frame = requestAnimationFrame(() => {
      try {
        renderer.current?.render(settings, compare, split / 100);
      } catch (e) {
        setError(messageOf(e));
        setGpuReady(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [settings, compare, split, image, gpuReady]);

  async function openImage(file?: File) {
    if (!file || exportLock.current) return;
    request.current?.abort();
    const task = new AbortController();
    request.current = task;
    setError('');
    setNotice('');
    setBusy('이미지를 확인하고 있습니다…');
    try {
      const next = await loadImage(file, task.signal, (text) => {
        if (!task.signal.aborted) setBusy(text);
      });
      if (task.signal.aborted) {
        releaseImage(next);
        return;
      }
      const previous = currentImage.current;
      currentImage.current = next;
      setGpuReady(false);
      setImage(next);
      setAllowReduced(false);
      // Cleanup after React has detached the previous preview renderer.
      requestAnimationFrame(() => releaseImage(previous));
    } catch (e) {
      if (!task.signal.aborted) setError(messageOf(e));
    } finally {
      if (!task.signal.aborted) setBusy('');
    }
  }
  function update(key: FilterKey, value: number) {
    if (!Number.isFinite(value)) return;
    const control = controls.find((c) => c.key === key)!;
    setSettings((s) => ({
      ...s,
      [key]: Math.max(control.min, Math.min(control.max, value)),
    }));
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024)
        throw new Error('설정 파일은 64KB 이하여야 합니다.');
      const next = parseRecipe(await file.text());
      setSettings(next);
      setError('');
      setNotice('필터 설정을 불러왔습니다.');
    } catch (e) {
      setError(messageOf(e));
    }
  }
  const exportSize = image
    ? fitSize(
        image.bitmap.width,
        image.bitmap.height,
        maxEdge,
        MAX_EXPORT_PIXELS,
      )
    : null;
  const needsReduction =
    !!image &&
    !!exportSize &&
    (exportSize.width !== image.bitmap.width ||
      exportSize.height !== image.bitmap.height);
  async function saveImage() {
    if (
      !image ||
      !exportSize ||
      exportLock.current ||
      (needsReduction && !allowReduced)
    )
      return;
    exportLock.current = true;
    setExporting(true);
    setError('');
    setNotice('');
    let output: FilterRenderer | null = null;
    let normalized: HTMLCanvasElement | null = null;
    let encoded: HTMLCanvasElement | null = null;
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      normalized = normalizeImage(
        image.bitmap,
        exportSize.width,
        exportSize.height,
      );
      output = new FilterRenderer(document.createElement('canvas'));
      output.setSource(normalized);
      output.render(settings);
      let target = output.canvas;
      if (format === 'image/jpeg') {
        encoded = document.createElement('canvas');
        encoded.width = target.width;
        encoded.height = target.height;
        const ctx = encoded.getContext('2d', { colorSpace: 'srgb' });
        if (!ctx) throw new Error('저장용 메모리가 부족합니다.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, encoded.width, encoded.height);
        ctx.drawImage(target, 0, 0);
        target = encoded;
      }
      const blob = await canvasBlob(target, format);
      download(
        blob,
        `${image.name.replace(/\.[^.]+$/, '')}-copycat.${format === 'image/png' ? 'png' : 'jpg'}`,
      );
      setNotice(
        `${exportSize.width.toLocaleString()} × ${exportSize.height.toLocaleString()} 이미지의 다운로드를 시작했습니다.`,
      );
    } catch (e) {
      setError(messageOf(e));
      setMaxEdge((edge) => Math.min(edge, 2048));
      setAllowReduced(false);
    } finally {
      output?.dispose(true);
      if (output) {
        output.canvas.width = 1;
        output.canvas.height = 1;
      }
      if (normalized) {
        normalized.width = 1;
        normalized.height = 1;
      }
      if (encoded) {
        encoded.width = 1;
        encoded.height = 1;
      }
      exportLock.current = false;
      setExporting(false);
    }
  }

  const displayScale = image
    ? Math.min(
        bounds.width / image.preview.width,
        bounds.height / image.preview.height,
        1,
      )
    : 1;
  return (
    <Theme theme={neutralTheme} mode="dark">
      <div className="studio" data-ready={ready}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Aperture size={25} strokeWidth={1.6} />
            </span>
            <h1>
              copycat<span>필터 실험실</span>
            </h1>
          </div>
          <div className="header-actions">
            <span className="local-status">
              <i />
              로컬 작업 공간
            </span>
            <Button
              label="이미지 불러오기"
              icon={<Upload size={16} />}
              onClick={() => input.current?.click()}
              isDisabled={!ready || exporting}
              size="lg"
            />
          </div>
        </header>
        <input
          className="file-input"
          ref={input}
          disabled={!ready || exporting}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          aria-label="이미지 파일 선택"
          onChange={(e) => {
            void openImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          className="file-input"
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          aria-label="필터 JSON 선택"
          onChange={(e) => {
            void importRecipe(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <main className="workspace">
          <section className="viewer-column" aria-label="이미지 미리보기">
            <div className="viewer-toolbar">
              <div className="section-label">
                <span className="tiny-index">01</span> 미리보기
              </div>
              <Switch
                label="원본과 비교"
                value={compare}
                onChange={setCompare}
                isDisabled={!image}
                size="sm"
              />
            </div>
            <div
              ref={stage}
              className={`drop-surface ${dragging ? 'is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!exporting) setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length > 1) {
                  setError('이미지는 한 번에 한 장씩 불러와 주세요.');
                  return;
                }
                void openImage(e.dataTransfer.files[0]);
              }}
            >
              {image ? (
                <div
                  className="image-frame"
                  style={{
                    width: image.preview.width * displayScale,
                    height: image.preview.height * displayScale,
                  }}
                >
                  <canvas
                    key={image.id}
                    ref={canvas}
                    aria-label="필터가 적용된 이미지"
                  />
                  {compare && (
                    <>
                      <span className="image-label before">원본</span>
                      <span className="image-label after">보정</span>
                      <div className="split-line" style={{ left: `${split}%` }}>
                        <span>
                          <ArrowLeftRight size={15} />
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="upload-symbol">
                    <ImagePlus size={34} strokeWidth={1.2} />
                  </div>
                  <p className="eyebrow">YOUR PHOTO, YOUR COLOR</p>
                  <h2>어떤 색감을 만들어 볼까요?</h2>
                  <p>사진을 여기에 놓거나 파일을 선택해 주세요.</p>
                  <Button
                    label="사진 선택하기"
                    isDisabled={!ready}
                    variant="primary"
                    className="primary-action"
                    icon={<Upload size={16} />}
                    size="lg"
                    onClick={() => input.current?.click()}
                  />
                  <span className="file-types">JPEG · PNG · WebP · HEIC</span>
                </div>
              )}
              {busy && (
                <output className="loading-overlay">
                  <span className="spinner" />
                  {busy}
                  <Button
                    label="취소"
                    variant="ghost"
                    onClick={() => {
                      request.current?.abort();
                      setBusy('');
                    }}
                  />
                </output>
              )}
              {dragging && (
                <div className="drag-overlay">사진을 놓아 불러오기</div>
              )}
            </div>
            <div className="viewer-bottom">
              <div className="file-meta">
                {image ? (
                  <>
                    <strong title={image.name}>{image.name}</strong>
                    <span>
                      {image.bitmap.width.toLocaleString()} ×{' '}
                      {image.bitmap.height.toLocaleString()} · {image.kind} ·
                      SDR
                    </span>
                  </>
                ) : (
                  <span>사진은 이 기기에서만 처리됩니다.</span>
                )}
              </div>
              <span className="preview-badge">
                {image ? '화면에 맞춤' : 'sRGB'}
              </span>
            </div>
            {image && compare && (
              <div className="compare-control">
                <span>원본</span>
                <Slider
                  label="원본과 보정 비교 위치"
                  isLabelHidden
                  value={split}
                  onChange={setSplit}
                  min={0}
                  max={100}
                  step={1}
                  valueDisplay="none"
                />
                <span>보정</span>
              </div>
            )}
            {image?.notice && <p className="image-notice">{image.notice}</p>}
            <div className="feedback" aria-live="polite">
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : notice ? (
                <p className="success">
                  <Check size={16} />
                  {notice}
                </p>
              ) : null}
            </div>
            <section className="preset-section" aria-labelledby="presets-title">
              <div className="preset-heading">
                <h2 id="presets-title">시작할 색감</h2>
                <span>프리셋 선택 후 자유롭게 조정하세요</span>
              </div>
              <div className="presets">
                {presets.map((p) => (
                  <Button
                    key={p.id}
                    label={p.name}
                    variant="ghost"
                    className={`preset ${activePreset?.id === p.id ? 'selected' : ''}`}
                    aria-pressed={activePreset?.id === p.id}
                    onClick={() => setSettings({ ...p.settings })}
                  >
                    <span className={`preset-swatch swatch-${p.id}`}>
                      <span>{p.hint}</span>
                      {activePreset?.id === p.id && <Check size={15} />}
                    </span>
                    <span className="preset-name">{p.name}</span>
                  </Button>
                ))}
              </div>
            </section>
          </section>
          <aside className="adjustments" aria-label="필터 조정">
            <div className="panel-heading">
              <div>
                <span className="tiny-index">02</span>
                <h2>색감 조정</h2>
              </div>
              <Button
                label="전체 초기화"
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => setSettings({ ...defaults })}
              />
            </div>
            <div className="active-look">
              <SlidersHorizontal size={15} />
              <span>{activePreset?.name ?? '사용자 설정'}</span>
              <span className="live-dot">실시간 적용</span>
            </div>
            <div className="controls">
              {controls.map((c) => (
                <div className={`control control-${c.key}`} key={c.key}>
                  <div className="control-heading">
                    <span>{c.label}</span>
                    <div>
                      <NumberInput
                        label={`${c.label} 값`}
                        isLabelHidden
                        value={settings[c.key]}
                        onChange={(v: number) => update(c.key, v)}
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        formatValue={(v) => v.toFixed(2)}
                        isWheelEnabled={false}
                        units={c.unit || undefined}
                        width={c.unit ? 100 : 82}
                        size="sm"
                      />
                      <Button
                        label={`${c.label} 초기화`}
                        variant="ghost"
                        isIconOnly
                        icon={<RotateCcw size={12} />}
                        size="sm"
                        onClick={() => update(c.key, defaults[c.key])}
                        isDisabled={settings[c.key] === defaults[c.key]}
                      />
                    </div>
                  </div>
                  <Slider
                    label={c.label}
                    isLabelHidden
                    value={settings[c.key]}
                    onChange={(v: number) => update(c.key, v)}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    valueDisplay="none"
                  />
                  <div className="range-labels">
                    <span>
                      {c.key === 'temperature'
                        ? '차갑게'
                        : c.key === 'tint'
                          ? '초록'
                          : c.min.toFixed(0)}
                    </span>
                    <span>
                      {c.key === 'temperature'
                        ? '따뜻하게'
                        : c.key === 'tint'
                          ? '마젠타'
                          : c.max.toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="export-panel">
              <h2>결과 저장</h2>
              <div className="format-row">
                <span>파일 형식</span>
                <div className="format-options">
                  {(['image/png', 'image/jpeg'] as const).map((type) => (
                    <Button
                      key={type}
                      label={type === 'image/png' ? 'PNG' : 'JPEG'}
                      size="sm"
                      variant={format === type ? 'secondary' : 'ghost'}
                      aria-pressed={format === type}
                      onClick={() => setFormat(type)}
                    />
                  ))}
                </div>
              </div>
              {format === 'image/jpeg' && (
                <p className="export-note">
                  품질 95% · 투명 영역은 흰색으로 저장됩니다.
                </p>
              )}
              {needsReduction && exportSize && (
                <div className="reduction">
                  <p>이 기기의 안전한 처리 한도를 넘어 축소가 필요합니다.</p>
                  <Switch
                    label={`${exportSize.width} × ${exportSize.height}로 축소 저장`}
                    value={allowReduced}
                    onChange={setAllowReduced}
                  />
                </div>
              )}
              <Button
                label={exporting ? '이미지 저장 중…' : '보정 이미지 저장'}
                variant="primary"
                className="primary-action"
                size="lg"
                width="100%"
                icon={<ArrowDownToLine size={16} />}
                onClick={() => void saveImage()}
                isLoading={exporting}
                isDisabled={
                  !image ||
                  !gpuReady ||
                  !!busy ||
                  (needsReduction && !allowReduced)
                }
              />
              <div className="json-actions">
                <Button
                  label="설정 불러오기"
                  variant="ghost"
                  size="sm"
                  icon={<FileJson size={14} />}
                  onClick={() => jsonInput.current?.click()}
                />
                <Button
                  label="JSON 저장"
                  variant="ghost"
                  size="sm"
                  icon={<ArrowDownToLine size={14} />}
                  onClick={() => {
                    download(
                      new Blob([JSON.stringify(recipe(settings), null, 2)], {
                        type: 'application/json',
                      }),
                      'copycat-filter.json',
                    );
                    setNotice('필터 설정의 다운로드를 시작했습니다.');
                  }}
                />
              </div>
            </div>
          </aside>
        </main>
        <footer>
          <span>COPYCAT FILTER LAB</span>
          <span>
            로컬 처리 <i /> sRGB <i /> iOS 이식용 설정
          </span>
          <span>Astryx 디자인 시스템</span>
        </footer>
      </div>
    </Theme>
  );
}
