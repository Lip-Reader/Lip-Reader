import type { ClipFile } from "../../lib/api";

export type Facing = "front" | "back";

/** Why the camera is unavailable; the screen turns this into a message. */
export type CameraError = "denied" | "failed";

export type Grade = "good" | "ok" | "bad";

/** Live picture-quality numbers for the on-screen readout, smoothed over about a second. */
export type Quality = {
  /** false while no face is found; the numbers are then all 0 */
  face: boolean;
  distCm: number;
  /** % of the frame the face fills, on whichever side is tighter; distance is graded on this */
  fill: number;
  cutOff: boolean;
  grades: Record<"fill" | "light" | "contrast" | "sharp" | "turn" | "move", Grade>;
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
  /** How long the last recording ran, in ms: the server divides the frame count by it
      to get the clip's real frame rate (the file header cannot be trusted). */
  durationRef?: { current: number };
  /** Latest live measurement, idle or recording. Web only. */
  qualityRef?: { current: Quality | null };
};

export const CAMERA_KEY = "chaplin_camera";
