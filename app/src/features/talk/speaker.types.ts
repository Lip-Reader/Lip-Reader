import type { SpokenToken } from "../../lib/api";

export type SpeakerPhase = "idle" | "preparing" | "playing";

export type Speaker = {
  phase: SpeakerPhase;
  tokens: SpokenToken[];
  spoken: number;
  error: string | null;
  play: (text: string, voiceId: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
};
