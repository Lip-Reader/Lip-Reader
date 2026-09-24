import { CameraView, useCameraPermissions } from "expo-camera";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { ClipFile } from "../../lib/api";
import { storage } from "../../lib/storage";
import { CAMERA_KEY, CameraError, Facing, Recorder } from "./recorder.types";

type Ctx = Recorder & { cameraRef: React.RefObject<CameraView | null>; onReady: () => void };
const RecorderCtx = createContext<Ctx | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [cam, requestCam] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<Facing>("front");
  const loadedRef = useRef(false);
  const cameraRef = useRef<CameraView | null>(null);
  const recordingRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);

  const ask = useCallback(async () => {
    if (!cam?.granted) await requestCam();
  }, [cam?.granted, requestCam]);

  useEffect(() => {
    ask();
  }, [ask]);

  useEffect(() => {
    storage.get(CAMERA_KEY).then((v) => {
      if (v === "back") setFacing("back");
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (loadedRef.current) storage.set(CAMERA_KEY, facing);
  }, [facing]);

  const granted = !!cam?.granted;
  const error: CameraError | null = cam && !granted ? "denied" : null;

  const start = useCallback(async () => {
    if (!cameraRef.current || !ready) return false;
    startedAtRef.current = Date.now();
    recordingRef.current = cameraRef.current.recordAsync({ maxDuration: 60 });
    return true;
  }, [ready]);

  const stop = useCallback(async (): Promise<ClipFile | null> => {
    const pending = recordingRef.current;
    if (!pending || !cameraRef.current) return null;
    cameraRef.current.stopRecording();
    durationRef.current = Date.now() - startedAtRef.current;
    recordingRef.current = null;
    const result = await pending;
    return result?.uri ? { uri: result.uri, name: "clip.mp4", type: "video/mp4" } : null;
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const flip = useCallback(() => setFacing((f) => (f === "front" ? "back" : "front")), []);

  const value = useMemo(
    () => ({ ready: ready && granted, error, facing, flip, start, stop, retry: ask, cameraRef, onReady, durationRef }),
    [ready, granted, error, facing, flip, start, stop, ask, onReady]
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
  if (!ctx || ctx.error) return null;
  return (
    <CameraView
      ref={ctx.cameraRef}
      style={StyleSheet.absoluteFill}
      facing={ctx.facing}
      mode="video"
      mute
      videoQuality="1080p"
      mirror={false}
      onCameraReady={ctx.onReady}
    />
  );
}
