import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { ClipFile } from "../../lib/api";
import type { Recorder } from "./recorder.types";

type Ctx = Recorder & { cameraRef: React.RefObject<CameraView | null>; onReady: () => void };
const RecorderCtx = createContext<Ctx | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);
  const recordingRef = useRef<Promise<{ uri: string } | undefined> | null>(null);

  const ask = useCallback(async () => {
    if (!cam?.granted) await requestCam();
    if (!mic?.granted) await requestMic();
  }, [cam?.granted, mic?.granted, requestCam, requestMic]);

  useEffect(() => {
    ask();
  }, [ask]);

  const granted = !!cam?.granted && !!mic?.granted;
  const error = cam && mic && !granted ? "Camera access is required." : null;

  const start = useCallback(async () => {
    if (!cameraRef.current || !ready) return false;
    recordingRef.current = cameraRef.current.recordAsync({ maxDuration: 60 });
    return true;
  }, [ready]);

  const stop = useCallback(async (): Promise<ClipFile | null> => {
    const pending = recordingRef.current;
    if (!pending || !cameraRef.current) return null;
    cameraRef.current.stopRecording();
    recordingRef.current = null;
    const result = await pending;
    return result?.uri ? { uri: result.uri, name: "clip.mp4", type: "video/mp4" } : null;
  }, []);

  const onReady = useCallback(() => setReady(true), []);

  const value = useMemo(
    () => ({ ready: ready && granted, error, start, stop, retry: ask, cameraRef, onReady }),
    [ready, granted, error, start, stop, ask, onReady]
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
      facing="front"
      mode="video"
      mirror={false}
      onCameraReady={ctx.onReady}
    />
  );
}
