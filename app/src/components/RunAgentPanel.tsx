import { useState } from "react";
import { executeText, ExecuteResult } from "../lib/api";
import { appendMessage, historyWindow } from "../lib/chat";
import { DEMO_PRESETS } from "../lib/presets";
import { useChat } from "../lib/chatContext";
import ChatPanel from "./ChatPanel";
import Spinner from "./Spinner";
import StepsTrace from "./StepsTrace";

type Mode = "presets" | "free";

export default function RunAgentPanel({ onClose }: { onClose: () => void }) {
  const { activeChatId, touch } = useChat();
  const [mode, setModeRaw] = useState<Mode>("presets");
  const [presetId, setPresetId] = useState(DEMO_PRESETS[0].id);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // demo presets are a static mirror of the DB seed (see lib/presets.ts):
  // rendered instantly, no network round-trips
  const presets = DEMO_PRESETS;
  const selectedPreset = presets.find((p) => p.id === presetId) ?? null;
  const presetContext = selectedPreset?.context ?? [];
  const canRun = mode === "presets" ? !!selectedPreset : !!prompt.trim();

  function setMode(m: Mode) {
    setModeRaw(m);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!canRun || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      if (mode === "presets" && selectedPreset) {
        // preset conversations are read-only demos: run with their context,
        // show the result inline, never append to them
        const history = presetContext.map(({ role, content }) => ({ role, content }));
        setResult(await executeText(selectedPreset.title, history));
      } else {
        // capture the memory window BEFORE appending the new prediction
        const history = activeChatId ? await historyWindow(activeChatId) : undefined;
        const res = await executeText(prompt.trim(), history);
        if (activeChatId) {
          try {
            await appendMessage(activeChatId, "self", res.response, res.steps);
            setPrompt("");
          } catch {
            // store hiccup: don't lose the prediction
            setResult(res);
          }
          touch();
        } else {
          setResult(res);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-gray-900/40 px-4 pb-4 backdrop-blur-sm sm:items-center sm:p-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}
    >
      <div className="animate-pop flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 sm:max-h-[92vh]">
        {/* header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Run Agent</h2>
            <p className="text-xs text-gray-500">
              Send a noisy transcription as text - no camera needed.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* mode switch */}
          <div className="flex rounded-full border border-gray-200 bg-gray-100 p-1 text-sm font-semibold">
            <ModeTab active={mode === "presets"} onClick={() => setMode("presets")}>
              Demo presets
            </ModeTab>
            <ModeTab active={mode === "free"} onClick={() => setMode("free")}>
              Free text
            </ModeTab>
          </div>

          {mode === "presets" ? (
            <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                Preset · noisy sentence with its conversation
              </label>
              <div className="relative mt-1.5">
                <select
                  value={presetId}
                  onChange={(e) => {
                    setPresetId(e.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-gray-900 outline-none focus:border-violet-500"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <svg
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>

              {selectedPreset && (
                <div className="mt-3 rounded-2xl border border-gray-100 bg-white/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    The conversation so far
                  </div>
                  <div className="mt-2 space-y-2">
                    {presetContext.map((m) => (
                      <div key={m.id} className="flex justify-start">
                        <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-gray-200 bg-gray-50 px-3.5 py-2 text-left text-sm text-gray-800">
                          {m.content}
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md border border-dashed border-violet-300 bg-violet-50 px-3.5 py-2 text-right text-sm text-violet-700">
                        {selectedPreset.title}
                        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-violet-400">
                          your lip-read sentence, to be corrected
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <RunButton onClick={run} disabled={!canRun || running} running={running} />
            </div>
          ) : (
            <>
              {/* conversation (second character) - optional context */}
              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/70 p-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-600">
                  <ChatBubbleIcon />
                  Conversation · optional context
                </label>
                <div className="mt-2">
                  <ChatPanel />
                </div>
              </div>

              {/* main input */}
              <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                    Sentence to correct · main input
                  </label>
                  <span aria-hidden className="animate-bounce text-lg leading-none">
                    👇
                  </span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="E.G. IM SO EXCITED TO ME YOU TODAY"
                  className="mt-1.5 w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-violet-500"
                />
                <RunButton onClick={run} disabled={!canRun || running} running={running} />
              </div>
            </>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* final response (presets always inline; free text inline unless in a chat) */}
          {result && (mode === "presets" || !activeChatId) && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Agent response
              </div>
              <p className="animate-pop mt-1.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-lg font-semibold text-green-700">
                {result.response}
              </p>

              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Steps trace · {result.steps.length} calls
              </div>
              <div className="mt-1.5">
                <StepsTrace steps={result.steps} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-full py-1.5 transition ${
        active ? "bg-white text-violet-700 shadow" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function RunButton({
  onClick,
  disabled,
  running,
}: {
  onClick: () => void;
  disabled: boolean;
  running: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-base font-bold text-white shadow-[0_8px_24px_rgba(109,40,217,0.3)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
    >
      {running ? <Spinner size={20} light /> : <BoltIcon />}
      {running ? "Running…" : "Run Agent"}
    </button>
  );
}

const BoltIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
