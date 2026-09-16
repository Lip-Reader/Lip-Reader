import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMySettings, putMySettings } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { storage } from "../../lib/storage";

export const DEFAULT_VOICE_ID = "Brian";
const KEY = "chaplin_settings";

type Settings = { voiceId: string; ready: boolean; setVoiceId: (id: string) => Promise<void> };

const Ctx = createContext<Settings>({ voiceId: DEFAULT_VOICE_ID, ready: false, setVoiceId: async () => {} });

async function readLocal(): Promise<string | null> {
  try {
    const raw = await storage.get(KEY);
    return raw ? (JSON.parse(raw).voice_id ?? null) : null;
  } catch {
    return null;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [voiceId, setVoice] = useState(DEFAULT_VOICE_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session.loaded) return;
    let alive = true;
    (async () => {
      const local = await readLocal();
      let voice = local;
      if (session.signedIn) {
        try {
          const token = await session.getToken();
          const server = await getMySettings(token);
          if (!server.voice_id && local) await putMySettings(token, local);
          voice = server.voice_id ?? local;
        } catch {}
      }
      if (!alive) return;
      setVoice(voice ?? DEFAULT_VOICE_ID);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [session.loaded, session.signedIn]);

  const setVoiceId = useCallback(
    async (id: string) => {
      setVoice(id);
      await storage.set(KEY, JSON.stringify({ voice_id: id }));
      if (session.signedIn) await putMySettings(await session.getToken(), id).catch(() => {});
    },
    [session]
  );

  const value = useMemo(() => ({ voiceId, ready, setVoiceId }), [voiceId, ready, setVoiceId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
