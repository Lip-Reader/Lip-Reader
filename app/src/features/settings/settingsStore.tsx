import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Gender, getMySettings, getPublicSettings, Language, putMySettings, UserSettings } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { storage } from "../../lib/storage";

export const DEFAULT_VOICE_ID = "Brian";
const KEY = "chaplin_settings";
const FIELDS = ["voice_id", "language", "gender", "patient_key"] as const;

// listen stays on this device: the microphone permission is per device too
type Local = Partial<UserSettings> & { listen?: boolean };
type Settings = {
  voiceId: string;
  language: Language;
  gender: Gender;
  patientKey: string | null;
  listen: boolean;
  ready: boolean;
  setVoiceId: (id: string) => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setGender: (gender: Gender) => Promise<void>;
  setListen: (listen: boolean) => Promise<void>;
};

const Ctx = createContext<Settings>({
  voiceId: DEFAULT_VOICE_ID,
  language: "en",
  gender: "m",
  patientKey: null,
  listen: true,
  ready: false,
  setVoiceId: async () => {},
  setLanguage: async () => {},
  setGender: async () => {},
  setListen: async () => {},
});

async function readLocal(): Promise<Local> {
  try {
    const raw = await storage.get(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function newPatientKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 3) | 8).toString(16);
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [state, setState] = useState<Local>({});
  const stateRef = useRef<Local>({});
  const [ready, setReady] = useState(false);

  // Local settings first, so language and patient key are right before Clerk finishes loading.
  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await readLocal();
      if (!local.patient_key) {
        local.patient_key = newPatientKey();
        await storage.set(KEY, JSON.stringify(local));
      }
      if (!alive) return;
      stateRef.current = { ...local, ...stateRef.current };
      setState(stateRef.current);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Then merge with the server copy (members) and fill the default voice.
  useEffect(() => {
    if (!session.loaded) return;
    let alive = true;
    (async () => {
      const local = await readLocal();
      let merged: Local = { ...local };
      if (session.signedIn) {
        try {
          const token = await session.getToken();
          const server = await getMySettings(token);
          const push: Local = {};
          for (const k of FIELDS) if (!server[k] && local[k]) (push as Record<string, unknown>)[k] = local[k];
          if (Object.keys(push).length) await putMySettings(token, push);
          merged = {
            voice_id: server.voice_id ?? local.voice_id,
            language: server.language ?? local.language,
            gender: server.gender ?? local.gender,
            patient_key: server.patient_key ?? local.patient_key,
            listen: local.listen,
          };
        } catch {}
      }
      if (!merged.voice_id) merged.voice_id = await getPublicSettings().then((s) => s.default_voice_id).catch(() => null);
      if (!merged.patient_key) merged.patient_key = stateRef.current.patient_key ?? newPatientKey();
      await storage.set(KEY, JSON.stringify(merged));
      if (!alive) return;
      stateRef.current = merged;
      setState(merged);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [session.loaded, session.signedIn]);

  const update = useCallback(
    async (patch: Local, sync = true) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setState(next);
      await storage.set(KEY, JSON.stringify(next));
      if (sync && session.signedIn) await putMySettings(await session.getToken(), patch).catch(() => {});
    },
    [session]
  );

  const setVoiceId = useCallback((id: string) => update({ voice_id: id }), [update]);
  const setLanguage = useCallback((language: Language) => update({ language }), [update]);
  const setGender = useCallback((gender: Gender) => update({ gender }), [update]);
  const setListen = useCallback((listen: boolean) => update({ listen }, false), [update]);

  const value = useMemo<Settings>(
    () => ({
      voiceId: state.voice_id || DEFAULT_VOICE_ID,
      language: state.language === "he" ? "he" : "en",
      gender: state.gender === "f" ? "f" : "m",
      patientKey: state.patient_key ?? null,
      listen: state.listen !== false,
      ready,
      setVoiceId,
      setLanguage,
      setGender,
      setListen,
    }),
    [state, ready, setVoiceId, setLanguage, setGender, setListen]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
