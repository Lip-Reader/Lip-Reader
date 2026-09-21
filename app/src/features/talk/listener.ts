import type { Language } from "../../lib/api";

// The browser's own speech recognition (Chrome, Safari; not Firefox or the native app).
// It only shows what was said next to what the lip reading suggested: the app never
// receives the sound, and the heard text never reaches the corrector.
const recognition = () => {
  const g = globalThis as any;
  return g.SpeechRecognition || g.webkitSpeechRecognition || null;
};

export const canListen = () => !!recognition();

/** Starts listening. stop() resolves with what was heard, "" when nothing was
    (silence, microphone refused). Safari only allows the start straight from a tap. */
export function startListening(language: Language): { stop: () => Promise<string> } | null {
  const Recognition = recognition();
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = language === "he" ? "he-IL" : "en-US";
  rec.continuous = true;
  rec.interimResults = true; // keeps a phrase that is still being worked out at stop()
  let heard = "";
  let ended = false;
  let onEnd = () => {};
  rec.onresult = (e: any) => {
    heard = Array.from(e.results as ArrayLike<any>).map((r) => r[0].transcript.trim()).join(" ");
  };
  rec.onend = () => {
    ended = true;
    onEnd();
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () =>
      new Promise((resolve) => {
        const done = () => resolve(heard.trim());
        if (ended) return done();
        onEnd = done;
        setTimeout(done, 2000); // "end" does not always fire
        rec.stop();
      }),
  };
}
