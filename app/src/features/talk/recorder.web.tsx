import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClipFile } from "../../lib/api";
import { storage } from "../../lib/storage";
import { CAMERA_KEY, CameraError, Facing, Grade, Quality, Recorder } from "./recorder.types";

const MIME_CANDIDATES = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

// Only the face area is uploaded: a centred square cut out of the camera frame.
// MIN_CROP is the server's no-upscale floor - _decode_clip scales anything smaller
// up to 640, and upscaling measured worse. Below it we send the frame uncropped.
const CROP = 800;
const MIN_CROP = 640;
// Multiplies the span of the four face keypoints (eyes, nose, mouth), the same
// quantity _zoom_to_face uses on the server, so both crops mean the same thing.
const MARGIN = 2.6;
const DETECT_MS = 120;     // re-detect ~8x a second, not every frame
const SMOOTH = 0.25;       // ease the window towards the face so it does not jitter
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

type Box = {
  cx: number; cy: number; side: number; faceW: number; eyePx: number;
  fill: number; cutOff: boolean; turn: number; mouthX: number; mouthY: number;
};

// Where each number turns red or green: [red below, green from, green to, red above].
// Only the fill (distance) limits come from measured runs: 83% read well, 92% and up
// came back as filler, and the clips that read best sat at 30-75%. The rest are first
// guesses, to be corrected from the quality numbers saved with every run.
type Metric = keyof Quality["grades"];
const LIMITS: Record<Metric, [number, number, number, number]> = {
  fill: [20, 30, 75, 88],
  light: [10, 25, 80, 92],
  contrast: [10, 20, Infinity, Infinity],
  sharp: [2, 4, Infinity, Infinity],
  turn: [-Infinity, -Infinity, 15, 30],
  move: [-Infinity, -Infinity, 15, 40],
};
const EASE = 0.15;  // per detection: steady enough to read, settles ~2s after the speaker moves
// The readout holds each number, and its colour, until it has moved this far, so it sits
// still while the speaker does. The averages saved with a run use the unheld numbers.
type Numbers = Record<Metric | "distCm", number>;
const STEP: Numbers = { distCm: 3, fill: 4, light: 5, contrast: 5, sharp: 1, turn: 5, move: 10 };
const PATCH = 96;   // the model reads the mouth as a 96px square, so measure it at that size

const NO_FACE: Quality = {
  face: false, distCm: 0, fill: 0, cutOff: false, light: 0, contrast: 0, sharp: 0, turn: 0, move: 0,
  grades: { fill: "bad", light: "ok", contrast: "ok", sharp: "ok", turn: "ok", move: "ok" },
};

/** Rough distance from the camera. Assumes an average 6.3cm between the pupils and
    a typical ~74 degree lens across the long side of the frame (a browser cannot read
    the real lens), so it is an estimate, not a measurement. */
function estimateCm(eyePx: number, w: number, h: number) {
  return eyePx > 0 ? Math.round(6.3 / (1.5 * (eyePx / Math.max(w, h)))) : 0;
}

function grade(v: number, [redBelow, greenFrom, greenTo, redAbove]: number[]): Grade {
  if (v < redBelow || v > redAbove) return "bad";
  return v >= greenFrom && v <= greenTo ? "good" : "ok";
}

/** Light, contrast and sharpness of the mouth area, at the size the model sees it.
    In the model's reference face the mouth patch is about 0.7 of the face width. */
function mouthStats(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, b: Box) {
  const side = 0.7 * b.faceW;
  ctx.clearRect(0, 0, PATCH, PATCH);
  ctx.drawImage(video, b.mouthX - side / 2, b.mouthY - side / 2, side, side, 0, 0, PATCH, PATCH);
  const px = ctx.getImageData(0, 0, PATCH, PATCH).data;
  const luma = new Float32Array(PATCH * PATCH);
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
    sum += luma[i];
  }
  const mean = sum / luma.length;
  let spread = 0;
  let edges = 0;
  for (let i = 0; i < luma.length; i++) {
    spread += (luma[i] - mean) ** 2;
    if (i % PATCH && i >= PATCH) edges += Math.abs(luma[i] - luma[i - 1]) + Math.abs(luma[i] - luma[i - PATCH]);
  }
  return {
    light: Math.round(mean / 2.55),
    contrast: Math.round(Math.sqrt(spread / luma.length) / 1.275),
    sharp: Math.round((10 * edges) / luma.length) / 10,
  };
}

/** Clip averages, saved with the run so the numbers can be compared with how it read. */
type Sample = Numbers & { cutOff: boolean };
function averageOf(s: Sample[]) {
  if (!s.length) return null;
  const mean = (f: (q: Sample) => number) => Math.round((10 * s.reduce((a, q) => a + f(q), 0)) / s.length) / 10;
  return {
    samples: s.length,
    fill: mean((q) => q.fill),
    cutOffPct: mean((q) => (q.cutOff ? 100 : 0)),
    light: mean((q) => q.light),
    contrast: mean((q) => q.contrast),
    sharp: mean((q) => q.sharp),
    turn: mean((q) => q.turn),
    move: mean((q) => q.move),
  };
}

let detectorPromise: Promise<any> | null = null;

/** Loaded once, lazily: it is only needed when a recording starts. */
function getDetector() {
  if (!detectorPromise) {
    // Loaded from the CDN at runtime: Metro cannot bundle this package's ESM/WASM
    // layout, and a bare import() fails with a 500. new Function hides it from the
    // bundler so the browser resolves the URL itself.
    const load = new Function("u", "return import(u)") as (u: string) => Promise<any>;
    detectorPromise = load(VISION)
      .then(async ({ FilesetResolver, FaceDetector }) => {
        const vision = await FilesetResolver.forVisionTasks(WASM);
        return FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL },
          runningMode: "VIDEO",
        });
      })
      .catch((e) => {
        console.warn("face detector unavailable, cropping to the centre instead", e);
        return null;
      });
  }
  return detectorPromise;
}

function faceBox(detector: any, video: HTMLVideoElement, now: number): Box | null {
  const res = detector?.detectForVideo?.(video, now);
  const bb = res?.detections?.[0]?.boundingBox;
  if (!bb) return null;
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  const kp = res.detections[0].keypoints;
  if (!kp || kp.length < 4) return null;
  const xs = kp.slice(0, 4).map((k: any) => k.x * w);
  const ys = kp.slice(0, 4).map((k: any) => k.y * h);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const eyePx = Math.abs(xs[0] - xs[1]);
  return {
    cx: bb.originX + bb.width / 2,
    cy: bb.originY + bb.height / 2,
    side: span * MARGIN,
    faceW: bb.width,
    eyePx,
    fill: Math.max(bb.width / w, bb.height / h),
    // a cut-off forehead is left out: the eyes, nose and mouth are what the model aligns to
    cutOff: bb.originX <= 1 || bb.originX + bb.width >= w - 1 || bb.originY + bb.height >= h - 1,
    // the nose tip sits ~3cm in front of eyes 6.3cm apart, so its sideways shift is ~half tan(turn)
    turn: Math.round(Math.atan((2 * Math.abs(xs[2] - (xs[0] + xs[1]) / 2)) / eyePx) * 57.3) || 0,
    mouthX: xs[3],
    mouthY: ys[3],
  };
}
const HIDDEN = "position:fixed;left:-9999px;width:1px;height:1px";

export type Framing = {
  frameW: number; frameH: number; faceW: number; facePct: number;
  cropSide: number; eyePx: number; distCm: number;
  /** why the crop did not run, when it did not */
  skipped?: "frame-too-small" | "no-detector" | "no-face";
  quality?: ReturnType<typeof averageOf>;
};

function pickMimeType(): string {
  return MIME_CANDIDATES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "video/webm";
}

type Ctx = Recorder & { attach: (el: HTMLVideoElement | null) => void };
const RecorderCtx = createContext<Ctx | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [facing, setFacing] = useState<Facing>("front");
  const loadedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<number | null>(null);
  const framingRef = useRef<Framing | null>(null);
  const boxRef = useRef<Box | null>(null);
  const qualityRef = useRef<Quality | null>(null);
  const samplesRef = useRef<Sample[]>([]);

  useEffect(() => {
    storage.get(CAMERA_KEY).then((v) => {
      if (v === "back") setFacing("back");
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (loadedRef.current) storage.set(CAMERA_KEY, facing);
  }, [facing]);

  useEffect(() => {
    let alive = true;
    setError(null);
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing === "front" ? "user" : "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 25 } },
        audio: false,
      })
      .then((stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (cropVideoRef.current) {
          cropVideoRef.current.srcObject = stream;
          cropVideoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "failed");
      });
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    };
  }, [attempt, facing]);

  // The picture is measured all the time the camera is on, so the speaker can settle
  // before pressing Talk. The recording loop follows the same face box through boxRef.
  useEffect(() => {
    if (!ready) return;
    const patch = document.createElement("canvas");
    patch.width = patch.height = PATCH;
    const ctx = patch.getContext("2d", { willReadFrequently: true });
    let detector: any = null;
    getDetector().then((d) => (detector = d));
    let prev: { cx: number; cy: number; t: number } | null = null;
    let smooth: Numbers | null = null;
    let shown: Numbers | null = null;
    let missed = 0;
    const id = setInterval(() => {
      const video = cropVideoRef.current;
      if (!detector || !ctx || !video?.videoWidth) return;
      const now = performance.now();
      const box = faceBox(detector, video, now);
      boxRef.current = box;
      if (!box) {
        prev = null;
        // the detector drops the odd frame; only call the face lost after half a second
        if (++missed >= 4) {
          smooth = shown = null;
          qualityRef.current = NO_FACE;
        }
        return;
      }
      missed = 0;
      const raw = {
        distCm: estimateCm(box.eyePx, video.videoWidth, video.videoHeight),
        fill: 100 * box.fill,
        ...mouthStats(ctx, video, box),
        turn: box.turn,
        move: prev ? (100 * Math.hypot(box.cx - prev.cx, box.cy - prev.cy)) / box.faceW / ((now - prev.t) / 1000) : 0,
      };
      prev = { cx: box.cx, cy: box.cy, t: now };
      if (smooth) for (const k of Object.keys(raw) as (keyof typeof raw)[]) smooth[k] += (raw[k] - smooth[k]) * EASE;
      else smooth = raw;
      if (recorderRef.current?.state === "recording") samplesRef.current.push({ ...smooth, cutOff: box.cutOff });
      if (!shown) shown = { ...smooth };
      else for (const k of Object.keys(STEP) as (keyof Numbers)[]) if (Math.abs(smooth[k] - shown[k]) >= STEP[k]) shown[k] = smooth[k];
      const s = shown;
      const grades = { ...NO_FACE.grades };
      for (const k of Object.keys(LIMITS) as Metric[]) grades[k] = grade(s[k], LIMITS[k]);
      // a face touching the frame edge is never "best", even at a good size
      if (box.cutOff && grades.fill === "good") grades.fill = "ok";
      const q: Quality = {
        face: true,
        cutOff: box.cutOff,
        grades,
        distCm: Math.round(s.distCm),
        fill: Math.round(s.fill),
        light: Math.round(s.light),
        contrast: Math.round(s.contrast),
        sharp: Math.round(10 * s.sharp) / 10,
        turn: Math.round(s.turn),
        move: Math.round(s.move),
      };
      qualityRef.current = q;
    }, DETECT_MS);
    return () => {
      clearInterval(id);
      boxRef.current = null;
      qualityRef.current = null;
    };
  }, [ready]);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  const start = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return false;

    // Only the face area is uploaded. A fixed-size window is cut out of the camera
    // frame and pans to follow the face, so nothing is ever scaled up.
    let source: MediaStream = stream;
    const video = cropVideoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    // Talk can be pressed before the hidden video has reported its size; without
    // this the crop is silently skipped and the whole frame goes up.
    if (video && !video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("loadedmetadata", done);
          resolve();
        };
        video.addEventListener("loadedmetadata", done);
        setTimeout(done, 1000);
      });
    }
    const w = video?.videoWidth || 0;
    const h = video?.videoHeight || 0;
    const blank = { frameW: w, frameH: h, faceW: 0, facePct: 0, cropSide: 0, eyePx: 0, distCm: 0 };
    samplesRef.current = [];
    if (Math.min(w, h) < MIN_CROP) {
      console.warn(`camera gave ${w}x${h}, too small to crop - uploading the whole frame`);
      framingRef.current = { ...blank, skipped: "frame-too-small" };
    }

    if (video && canvas && ctx && Math.min(w, h) >= MIN_CROP) {
      const detector = await getDetector();
      const found = boxRef.current ?? (detector ? faceBox(detector, video, performance.now()) : null);
      if (!detector) framingRef.current = { ...blank, skipped: "no-detector" };
      else if (!found) framingRef.current = { ...blank, skipped: "no-face" };

      // window size is fixed for the whole clip so no frame is ever rescaled
      const side = Math.round(
        Math.min(Math.max(found?.side ?? CROP, MIN_CROP), w, h)
      );
      const clamp = (v: number, max: number) => Math.min(Math.max(v, side / 2), max - side / 2);
      let cx = clamp(found?.cx ?? w / 2, w);
      let cy = clamp(found?.cy ?? h / 2, h);

      canvas.width = canvas.height = side;
      const record = (b: Box | null) => {
        framingRef.current = {
          frameW: w, frameH: h,
          faceW: Math.round(b?.faceW ?? 0),
          facePct: b ? Math.round((100 * b.faceW) / w) : 0,
          cropSide: side,
          eyePx: Math.round(b?.eyePx ?? 0),
          distCm: b ? estimateCm(b.eyePx, w, h) : 0,
        };
      };
      record(found);
      let last = found;
      const draw = () => {
        // the measuring loop owns the detector; ease once per new box, not once per frame
        const box = boxRef.current;
        if (box && box !== last) {
          last = box;
          record(box);
          cx += (clamp(box.cx, w) - cx) * SMOOTH;
          cy += (clamp(box.cy, h) - cy) * SMOOTH;
        }
        ctx.drawImage(video, Math.round(cx - side / 2), Math.round(cy - side / 2),
                      side, side, 0, 0, side, side);
        drawRef.current = requestAnimationFrame(draw);
      };
      draw();
      source = canvas.captureStream(25);
    }

    const recorder = new MediaRecorder(source, { mimeType: pickMimeType() });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    return true;
  }, []);

  const stop = useCallback((): Promise<ClipFile | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        if (drawRef.current !== null) cancelAnimationFrame(drawRef.current);
        drawRef.current = null;
        const quality = averageOf(samplesRef.current);
        if (framingRef.current && quality) framingRef.current = { ...framingRef.current, quality };
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        chunksRef.current = [];
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  // One input, kept in the DOM: iOS Safari does not reliably fire "change" on a
  // detached input, and the page can be suspended while the camera is open.
  useEffect(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px";
    document.body.appendChild(input);
    fileInputRef.current = input;
    return () => {
      input.remove();
      fileInputRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = HIDDEN;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = HIDDEN;
    document.body.append(video, canvas);
    cropVideoRef.current = video;
    canvasRef.current = canvas;
    return () => {
      video.remove();
      canvas.remove();
      cropVideoRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  const pickClip = useCallback((): Promise<ClipFile | null> => {
    const input = fileInputRef.current;
    if (!input) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        input.onchange = null;
        input.oncancel = null;
        resolve(file);
      };
      input.value = ""; // so picking the same file twice still fires change
      input.onchange = () => finish(input.files?.[0] ?? null);
      // some mobile browsers fire cancel on the way back from the camera; let a
      // change event that is still in flight win.
      input.oncancel = () => setTimeout(() => finish(null), 400);
      input.click();
    });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const flip = useCallback(() => setFacing((f) => (f === "front" ? "back" : "front")), []);

  const value = useMemo(
    () => ({ ready, error, facing, flip, start, stop, retry, pickClip, attach, framingRef, qualityRef }),
    [ready, error, facing, flip, start, stop, retry, pickClip, attach]
  );
  return <RecorderCtx.Provider value={value}>{children}</RecorderCtx.Provider>;
}

export function useRecorder(): Recorder {
  const ctx = useContext(RecorderCtx);
  if (!ctx) throw new Error("RecorderProvider missing");
  return ctx;
}

export function CameraPreview() {
  const ctx = useContext(RecorderCtx);
  const facing = ctx?.facing ?? "front";
  return (
    <video
      ref={ctx?.attach}
      autoPlay
      muted
      playsInline
      data-facing={facing}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: facing === "front" ? "scaleX(-1)" : "none",
        background: "#000",
      }}
    />
  );
}

