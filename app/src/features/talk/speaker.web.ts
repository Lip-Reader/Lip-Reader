import { useCallback, useEffect, useRef, useState } from "react";
import { speak, SpokenToken } from "../../lib/api";
import type { Speaker, SpeakerPhase } from "./speaker.types";

export function useSpeaker(): Speaker {
  const [phase, setPhase] = useState<SpeakerPhase>("idle");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cacheRef = useRef<{ key: string; uri: string; tokens: SpokenToken[] } | null>(null);

  const halt = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => halt, [halt]);

  const play = useCallback(
    async (text: string, voiceId: string) => {
      halt();
      setError(null);
      const key = `${voiceId}::${text}`;
      let clip = cacheRef.current?.key === key ? cacheRef.current : null;
      if (!clip) {
        setPhase("preparing");
        try {
          const { audioUri, tokens: tk } = await speak(text, voiceId);
          clip = { key, uri: audioUri, tokens: tk };
          cacheRef.current = clip;
        } catch {
          setError("Couldn't play the voice.");
          setPhase("idle");
          return;
        }
      }
      const tk = clip.tokens;
      setTokens(tk);
      setSpoken(0);
      const audio = new Audio(clip.uri);
      audioRef.current = audio;
      const tick = () => {
        let n = 0;
        while (n < tk.length && tk[n].start <= audio.currentTime) n++;
        setSpoken(n);
        if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick);
      };
      audio.onplay = () => {
        setPhase("playing");
        rafRef.current = requestAnimationFrame(tick);
      };
      audio.onended = () => {
        setSpoken(tk.length);
        setPhase("idle");
      };
      try {
        await audio.play();
      } catch {
        setError("Couldn't play the voice.");
        setPhase("idle");
      }
    },
    [halt]
  );

  const stop = useCallback(() => {
    halt();
    setSpoken(tokens.length);
    setPhase("idle");
  }, [halt, tokens.length]);

  const reset = useCallback(() => {
    halt();
    cacheRef.current = null;
    setTokens([]);
    setSpoken(0);
    setError(null);
    setPhase("idle");
  }, [halt]);

  return { phase, tokens, spoken, error, play, stop, reset };
}
