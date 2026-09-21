import type { ClipFile } from "../../lib/api";

export type Facing = "front" | "back";

/** Why the camera is unavailable; the screen turns this into a message. */
export type CameraError = "denied" | "failed";

/** Live picture-quality numbers for the on-screen readout. Only distance is judged:
    the rest have no measured limits yet, so they are shown and stored, not coloured. */
export type Quality = {
  distCm: number;
  /** "close" / "far" only where reading is known to break; null when unsure */
  range: "good" | "close" | "far" | null;
  /** % of the frame the face fills, on whichever side is tighter */
  fill: number;
  cutOff: boolean;
  /** 0-100: mean brightness and spread of the mouth area */
  light: number;
  contrast: number;
  /** edge strength of the mouth area; higher is crisper */
  sharp: number;
  /** head turn left/right in rough degrees, 0 = facing the camera */
  turn: number;
  /** how far the face moves per second, as % of its width */
  move: number;
};

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
  /** Latest live measurement, idle or recording. Web only. */
  qualityRef?: { current: Quality | null };
};

export const CAMERA_KEY = "chaplin_camera";
