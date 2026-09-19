import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClipFile } from "../../lib/api";
import type { Recorder } from "./recorder.types";

const MIME_CANDIDATES = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

function pickMimeType(): string {
  return MIME_CANDIDATES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "video/webm";
}

type Ctx = Recorder & { attach: (el: HTMLVideoElement | null) => void };
const RecorderCtx = createContext<Ctx | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 25 } }, audio: false })
      .then((stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access is required."
            : "Could not start the camera."
        );
      });
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    };
  }, [attempt]);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  const start = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return false;
    const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
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
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        chunksRef.current = [];
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ ready, error, start, stop, retry, attach }), [ready, error, start, stop, retry, attach]);
  return <RecorderCtx.Provider value={value}>{children}</RecorderCtx.Provider>;
}

export function useRecorder(): Recorder {
  const ctx = useContext(RecorderCtx);
  if (!ctx) throw new Error("RecorderProvider missing");
  return ctx;
}

export function CameraPreview() {
  const ctx = useContext(RecorderCtx);
  return (
    <video
      ref={ctx?.attach}
      autoPlay
      muted
      playsInline
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: "scaleX(-1)",
        background: "#000",
      }}
    />
  );
}
