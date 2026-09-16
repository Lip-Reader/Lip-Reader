import type { ClipFile } from "../../lib/api";

export type Recorder = {
  ready: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => Promise<ClipFile | null>;
  retry: () => void;
};
