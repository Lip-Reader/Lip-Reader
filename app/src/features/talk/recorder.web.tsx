import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClipFile } from "../../lib/api";
import { storage } from "../../lib/storage";
import { CAMERA_KEY, CameraError, Facing, Recorder } from "./recorder.types";

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

type Box = { cx: number; cy: number; side: number; faceW: number; eyePx: number };

/** Rough distance from the camera. Assumes an average 6.3cm between the pupils and
    a typical ~74 degree lens, so it is an estimate, not a measurement. */
function estimateCm(eyePx: number, frameW: number) {
  return eyePx > 0 ? Math.round((6.3 / (1.5 * (eyePx / frameW))) ) : 0;
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
  return {
    cx: bb.originX + bb.width / 2,
    cy: bb.originY + bb.height / 2,
    side: span * MARGIN,
    faceW: bb.width,
    eyePx: Math.abs(xs[0] - xs[1]),
  };
}
const HIDDEN = "position:fixed;left:-9999px;width:1px;height:1px";

export type Framing = {
  frameW: number; frameH: number; faceW: number; facePct: number;
  cropSide: number; eyePx: number; distCm: number;
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
    if (!w || !h) console.warn("camera size unknown, uploading the whole frame");

    if (video && canvas && ctx && Math.min(w, h) >= MIN_CROP) {
      const detector = await getDetector();
      const found = detector ? faceBox(detector, video, performance.now()) : null;

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
          distCm: b ? estimateCm(b.eyePx, w) : 0,
        };
      };
      record(found);
      let lastDetect = 0;
      const draw = () => {
        const now = performance.now();
        if (detector && now - lastDetect > DETECT_MS) {
          lastDetect = now;
          const box = faceBox(detector, video, now);
          if (box) {
            record(box);
            cx += (clamp(box.cx, w) - cx) * SMOOTH;
            cy += (clamp(box.cy, h) - cy) * SMOOTH;
          }
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
    () => ({ ready, error, facing, flip, start, stop, retry, pickClip, attach, framingRef }),
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

