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
const HIDDEN = "position:fixed;left:-9999px;width:1px;height:1px";

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

    // Draw a centred square of the camera frame into a canvas and record that, so
    // only the face area leaves the device. Too small to crop -> send it whole.
    let source: MediaStream = stream;
    const video = cropVideoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const side = Math.min(CROP, video?.videoWidth || 0, video?.videoHeight || 0);
    if (video && canvas && ctx && side >= MIN_CROP) {
      canvas.width = canvas.height = side;
      const draw = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
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
    () => ({ ready, error, facing, flip, start, stop, retry, pickClip, attach }),
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
    <>
      <FaceGuide />
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
    </>
  );
}

/** Shows where to sit: only the middle of the frame is uploaded, and filling this
    oval is what "close enough" looks like. Sitting back is the single biggest
    cause of bad readings. */
function FaceGuide() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        top: "46%",
        transform: "translate(-50%, -50%)",
        height: "58%",
        aspectRatio: "3 / 4",
        border: "3px dashed rgba(255,255,255,0.55)",
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}
