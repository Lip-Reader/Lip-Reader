import { API_BASE, VSR_BASE, architectureUrl } from "../lib/api";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-gray-900/40 px-4 pb-4 backdrop-blur-sm sm:items-center sm:p-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}
    >
      <div className="animate-pop flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 sm:max-h-[92vh]">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/chaplin_logo.png" alt="Chaplin AI" className="h-9 w-9" />
            <h2 className="text-lg font-bold text-gray-900">About Chaplin AI</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-gray-600">
          <p>
            <strong className="text-gray-900">Chaplin AI</strong> helps non-vocal, ventilated
            patients communicate: it lip-reads them from the camera and speaks the result
            back in a natural voice.
          </p>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Architecture
            </div>
            <p className="mt-1">
              A webcam clip is transcribed by the <Chip c="amber">vsr</Chip> model
              (Auto-AVSR). A single <Chip c="violet">correct</Chip> LLM call then turns the
              noisy transcription into a natural, punctuated sentence — using the
              conversation history to pick between visually similar words when one fits
              the context better — before returning the final response with a full steps
              trace.
            </p>
            <img
              src={architectureUrl}
              alt="Architecture diagram"
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white"
            />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              How to enter input
            </div>
            <ul className="mt-1.5 space-y-2">
              <li>
                <Chip c="rose">Talk</Chip> - turn the camera on and record a short clip of
                yourself speaking silently; the sentence appears on screen and can be spoken
                aloud with Speak.
              </li>
              <li>
                <Chip c="violet">Run Agent</Chip> - type (or pick a preset) noisy
                transcription as text; the agent corrects it and shows every step it took.
              </li>
              <li>
                <Chip c="sky">Chat</Chip> - start or continue a conversation and add what
                the other person says; your predictions join the chat, and the agent uses
                the recent messages to fix words that don't fit the context.
              </li>
            </ul>
            <p className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
              <WarnIcon className="mt-0.5 shrink-0" />
              Lip-reading runs on a separate GPU service - the first Talk after a while may
              take a moment while it warms up.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              API
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Base URL:{" "}
              <a
                href={API_BASE || window.location.origin}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-medium text-violet-600 hover:underline"
              >
                {API_BASE || window.location.origin}
              </a>
            </p>
            <div className="mt-1.5 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60">
              <ApiRow method="GET" path="/api/team_info" text="student and team details" />
              <ApiRow method="GET" path="/api/agent_info" text="agent description, prompts, examples" />
              <ApiRow method="GET" path="/api/model_architecture" text="architecture diagram (PNG)" />
              <ApiRow method="POST" path="/api/execute" text="correct a text prompt" />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Lip-reading is served by the separate <span className="font-medium text-gray-700">vsr_lip_reader</span>{" "}
              service (GPU, on Modal):
            </p>
            <div className="mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60">
              <ApiRow method="POST" path="/api/execute_lips" text="lip-read a video clip" />
            </div>
            <p className="mt-1 break-all text-xs text-gray-500">
              at{" "}
              <a
                href={VSR_BASE}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-medium text-violet-600 hover:underline"
              >
                {VSR_BASE}
              </a>
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4 text-center">
            <p className="text-base font-semibold text-gray-900">Adam Sion &amp; Jonathan Eshel</p>
            <p className="mt-0.5 text-sm text-gray-500">Chaplin AI</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHIP: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  violet: "bg-violet-100 text-violet-700 border-violet-300",
  sky: "bg-sky-100 text-sky-700 border-sky-300",
  rose: "bg-rose-100 text-rose-700 border-rose-300",
};

function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${CHIP[c]}`}>
      {children}
    </span>
  );
}

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-gray-200 text-gray-700",
  POST: "bg-violet-200 text-violet-800",
};

function ApiRow({ method, path, text }: { method: string; path: string; text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 text-xs">
      <span
        className={`w-11 shrink-0 rounded-md py-0.5 text-center font-mono font-bold ${METHOD_STYLE[method]}`}
      >
        {method}
      </span>
      <code className="shrink-0 font-mono font-medium text-gray-800">{path}</code>
      <span className="truncate text-gray-500">{text}</span>
    </div>
  );
}

const WarnIcon = ({ className = "" }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
