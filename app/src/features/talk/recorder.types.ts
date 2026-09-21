import type { ClipFile } from "../../lib/api";

export type Facing = "front" | "back";

/** Why the camera is unavailable; the screen turns this into a message. */
export type CameraError = "denied" | "failed";

export type Recorder = {
  ready: boolean;
  error: CameraError | null;
  facing: Facing;
  flip: () => void;
  start: () => Promise<boolean>;
  stop: () => Promise<ClipFile | null>;
  retry: () => void;
  /** Pick an existing video file. Web only for now; undefined on native. */
  pickClip?: () => Promise<ClipFile | null>;
  /** How the speaker was framed in the last recording. Web only. */
  framingRef?: { current: unknown };
};

export const CAMERA_KEY = "chaplin_camera";
