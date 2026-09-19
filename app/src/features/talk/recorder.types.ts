import type { ClipFile } from "../../lib/api";

export type Facing = "front" | "back";

export type Recorder = {
  ready: boolean;
  error: string | null;
  facing: Facing;
  flip: () => void;
  start: () => Promise<boolean>;
  stop: () => Promise<ClipFile | null>;
  retry: () => void;
};

export const CAMERA_KEY = "chaplin_camera";
