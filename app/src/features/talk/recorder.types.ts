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
};

export const CAMERA_KEY = "chaplin_camera";
