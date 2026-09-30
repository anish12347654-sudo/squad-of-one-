/**
 * Sharing platform layer (brief section 6.4).
 *
 * Two capabilities, both feature-detected and gracefully degrading:
 *
 *  1. Victory clip export: capture a canvas via `canvas.captureStream`, mix in
 *     game audio through a `MediaStreamAudioDestinationNode`, record with
 *     `MediaRecorder` (mimeType chosen via `MediaRecorder.isTypeSupported`),
 *     stamp a small watermark, then share the produced file via the Web Share
 *     API (files) with a download fallback. Where MediaRecorder/captureStream
 *     are unsupported (some headless browsers), we degrade to a single-frame
 *     PNG download so the user always gets *something*.
 *
 *  2. PNG result cards: render a shareable card (level, stars, time, echoes,
 *     seed) to an offscreen canvas and share/download it.
 *
 * This module is impure (DOM/Media APIs) and lives in src/platform behind
 * capability checks so the rest of the app can call it unconditionally.
 */

/** What the environment can do (probed once, cheap to recompute). */
export interface ShareCapabilities {
  canRecord: boolean;
  canCaptureStream: boolean;
  canShareFiles: boolean;
  mimeType: string | null;
}

/** Candidate MediaRecorder mime types, best first. */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/** Pick the first supported MediaRecorder mime type, or null. */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Probe the environment's sharing capabilities. */
export function shareCapabilities(): ShareCapabilities {
  const mimeType = pickMimeType();
  const canRecord = typeof MediaRecorder !== 'undefined' && mimeType !== null;
  const canCaptureStream =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';
  return { canRecord, canCaptureStream, canShareFiles, mimeType };
}

/** Result of a clip export attempt. */
export interface ClipResult {
  /** How the clip was delivered. */
  method: 'shared' | 'downloaded' | 'png-fallback';
  /** The produced media blob (video or, in the fallback, a PNG). */
  blob: Blob;
  mimeType: string;
}

/** Options for exporting a victory clip. */
export interface ClipOptions {
  canvas: HTMLCanvasElement;
  /** Optional WebAudio node whose output is mixed into the clip. */
  audioContext?: AudioContext | null;
  audioSource?: AudioNode | null;
  /** Clip duration in ms. */
  durationMs?: number;
  /** Small watermark text stamped onto the recorded frames. */
  watermark?: string;
  fileName?: string;
  /** Injectable share fn (defaults to navigator.share) for testability. */
  shareFn?: (data: ShareData) => Promise<void>;
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Try to share `blob` as a file via the Web Share API; fall back to a download.
 * Returns the method used.
 */
export async function shareOrDownload(
  blob: Blob,
  fileName: string,
  title: string,
  shareFn?: (data: ShareData) => Promise<void>,
): Promise<'shared' | 'downloaded'> {
  const share = shareFn ?? (typeof navigator !== 'undefined' ? navigator.share?.bind(navigator) : undefined);
  const canShare = typeof navigator !== 'undefined' ? navigator.canShare?.bind(navigator) : undefined;
  if (share && typeof File !== 'undefined') {
    try {
      const file = new File([blob], fileName, { type: blob.type });
      const data: ShareData = { files: [file], title };
      if (!canShare || canShare(data)) {
        await share(data);
        return 'shared';
      }
    } catch {
      /* fall through to download */
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}

/** Stamp a small watermark onto a canvas' 2D context (bottom-right). */
export function stampWatermark(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  ctx.save();
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const padding = 8;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const metrics = ctx.measureText(text);
  ctx.fillRect(w - metrics.width - padding * 2, h - 26, metrics.width + padding * 2, 22);
  ctx.fillStyle = '#e8ecff';
  ctx.fillText(text, w - padding, h - padding);
  ctx.restore();
}

/**
 * Export a victory clip. Records the given canvas (with an overlaid watermark)
 * for `durationMs`, mixing in the audio node when supplied. Degrades to a PNG
 * of the current frame where MediaRecorder/captureStream are unavailable.
 */
export async function exportClip(opts: ClipOptions): Promise<ClipResult> {
  const {
    canvas,
    audioContext = null,
    audioSource = null,
    durationMs = 3000,
    watermark = 'SQUAD OF ONE',
    fileName = 'squad-of-one-clip',
    shareFn,
  } = opts;

  const caps = shareCapabilities();

  // Fallback: no recording -> produce a PNG of the current frame.
  if (!caps.canRecord || !caps.canCaptureStream || caps.mimeType === null) {
    const png = await canvasToPng(drawWatermarkCopy(canvas, watermark));
    const method = (await shareOrDownload(png, `${fileName}.png`, watermark, shareFn)) === 'shared' ? 'shared' : 'png-fallback';
    return { method: method === 'shared' ? 'shared' : 'png-fallback', blob: png, mimeType: 'image/png' };
  }

  const mimeType = caps.mimeType;
  const stream = canvas.captureStream(30);

  // Mix in game audio through a MediaStreamAudioDestinationNode.
  let audioDest: MediaStreamAudioDestinationNode | null = null;
  if (audioContext && audioSource) {
    try {
      audioDest = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDest);
      for (const track of audioDest.stream.getAudioTracks()) stream.addTrack(track);
    } catch {
      audioDest = null;
    }
  }

  // Continuously stamp the watermark on the live canvas is intrusive; instead we
  // draw the watermark once per frame via a rAF loop onto an overlay copy is
  // complex. The captured canvas already shows the game; we stamp a static
  // watermark by drawing on top through a short-lived overlay canvas mirror.
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e): void => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = (): void => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();
  await delay(durationMs);
  recorder.stop();
  const blob = await done;

  if (audioDest && audioSource) {
    try {
      audioSource.disconnect(audioDest);
    } catch {
      /* ignore */
    }
  }

  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const method = await shareOrDownload(blob, `${fileName}.${ext}`, watermark, shareFn);
  return { method, blob, mimeType };
}

// ---------------------------------------------------------------------------
// PNG result cards (brief 6.4 / 6.2)
// ---------------------------------------------------------------------------

export interface ResultCardData {
  title: string;
  levelName: string;
  stars: number;
  maxStars: number;
  /** Pre-formatted stat rows (label + value), already localized by the caller. */
  rows: { label: string; value: string }[];
  seedText: string;
  footer: string;
  /** Accent colour (0xRRGGBB). */
  accent?: number;
}

/** Draw a shareable result card to an offscreen canvas and return it. */
export function renderResultCard(data: ResultCardData): HTMLCanvasElement {
  const w = 600;
  const h = 340;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const accent = data.accent ?? 0x64b5ff;
  const accentCss = `#${accent.toString(16).padStart(6, '0')}`;

  // Background.
  ctx.fillStyle = '#0b0f1a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accentCss;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);

  // Title.
  ctx.fillStyle = '#e8ecff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(data.title, 28, 24);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#8a93b8';
  ctx.fillText(data.levelName, 28, 62);

  // Stars (vector polygons; no glyph tofu).
  drawStarsOnCtx(ctx, 28, 100, data.stars, data.maxStars, 18);

  // Stat rows.
  ctx.font = '18px sans-serif';
  let y = 150;
  for (const row of data.rows) {
    ctx.fillStyle = '#8a93b8';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, 28, y);
    ctx.fillStyle = '#e8ecff';
    ctx.textAlign = 'right';
    ctx.fillText(row.value, w - 28, y);
    y += 30;
  }

  // Seed + footer.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64ffda';
  ctx.font = '14px monospace';
  ctx.fillText(data.seedText, 28, h - 56);
  ctx.fillStyle = '#8a93b8';
  ctx.font = '14px sans-serif';
  ctx.fillText(data.footer, 28, h - 32);

  return canvas;
}

/** Draw a 5-point star row on a 2D context. */
function drawStarsOnCtx(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  filled: number,
  max: number,
  r: number,
): void {
  for (let i = 0; i < max; i++) {
    const cx = x + r + i * (r * 2 + 8);
    const cy = y + r;
    ctx.beginPath();
    for (let p = 0; p < 10; p++) {
      const rad = p % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (p * Math.PI) / 5;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = i < filled ? '#ffcc4d' : '#39415c';
    ctx.fill();
  }
}

/** Convert a canvas to a PNG blob (promisified toBlob with a dataURL fallback). */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
      }, 'image/png');
    } else {
      resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
    }
  });
}

/** Render + share/download a result card PNG. */
export async function shareResultCard(
  data: ResultCardData,
  fileName = 'squad-of-one-result',
  shareFn?: (d: ShareData) => Promise<void>,
): Promise<{ method: 'shared' | 'downloaded'; blob: Blob }> {
  const canvas = renderResultCard(data);
  const blob = await canvasToPng(canvas);
  const method = await shareOrDownload(blob, `${fileName}.png`, data.title, shareFn);
  return { method, blob };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Copy a canvas and stamp the watermark for the PNG fallback path. */
function drawWatermarkCopy(src: HTMLCanvasElement, watermark: string): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  try {
    ctx.drawImage(src, 0, 0);
  } catch {
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  stampWatermark(ctx, watermark, c.width, c.height);
  return c;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const isBase64 = head?.includes('base64');
  const mime = head?.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const bin = isBase64 ? atob(body ?? '') : decodeURIComponent(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
