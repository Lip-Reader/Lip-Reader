import { AudioPlayer, createAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { speak, SpokenToken } from "../../lib/api";
import type { Speaker, SpeakerPhase } from "./speaker.types";

export function useSpeaker(): Speaker {
  const [phase, setPhase] = useState<SpeakerPhase>("idle");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cacheRef = useRef<{ key: string; uri: string; tokens: SpokenToken[] } | null>(null);

  const halt = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    playerRef.current?.remove();
    playerRef.current = null;
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
      const player = createAudioPlayer({ uri: clip.uri });
      playerRef.current = player;
      player.addListener("playbackStatusUpdate", (s) => {
        if (s.didJustFinish) {
          setSpoken(tk.length);
          setPhase("idle");
          if (timerRef.current) clearInterval(timerRef.current);
        }
      });
      timerRef.current = setInterval(() => {
        let n = 0;
        while (n < tk.length && tk[n].start <= player.currentTime) n++;
        setSpoken(n);
      }, 50);
      setPhase("playing");
      player.play();
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
