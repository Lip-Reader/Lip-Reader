import { useEffect, useRef, useState } from "react";
import { executeLips, speak, SpokenToken, Step, vsrAvailable } from "../lib/api";
import { appendMessage, historyWindow } from "../lib/chat";
import { useChat } from "../lib/chatContext";
import { getStoredVoiceId } from "../lib/voice";
import { useRecorder } from "../lib/useRecorder";
import AboutModal from "./AboutModal";
import ChatPanel from "./ChatPanel";
import RunAgentPanel from "./RunAgentPanel";
import Spinner from "./Spinner";
import StepsTrace from "./StepsTrace";

type Phase = "idle" | "recording" | "thinking" | "review" | "speaking";

export default function TalkScreen({ onChangeVoice }: { onChangeVoice: () => void }) {
  const { error, start, stop, attachPreview, startCamera, stopCamera } = useRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [showAgent, setShowAgent] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const { activeChatId, touch } = useChat();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [vsrOk, setVsrOk] = useState(true);
  useEffect(() => {
    vsrAvailable().then(setVsrOk);
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (cameraOn) {
      attachPreview(videoRef.current);
      startCamera().catch(() => {
        setApiError("Camera access is required.");
        setCameraOn(false);
      });
    } else {
      stopCamera();
      stopAudio();
      // keep apiError - it may explain why the camera turned off
      setText("");
      setTokens([]);
      setSpoken(0);
      setSteps([]);
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  useEffect(() => () => stopAudio(), []);

  useEffect(() => {
    if (phase !== "recording") return;
    setRecSeconds(0);
    const id = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function stopAudio() {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.pause();
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    audioRef.current = null;
  }

  function clearUtterance() {
    setText("");
    setTokens([]);
    setSpoken(0);
    setSteps([]);
    setApiError(null);
  }

  async function record() {
    if (!vsrOk) {
      setToast("The lip-reading service is unavailable right now - use Run Agent instead.");
      return;
    }
    stopAudio();
    clearUtterance();
    await start();
    setPhase("recording");
  }

  async function finishRecording() {
    setPhase("thinking");
    const clip = await stop();
    if (!clip) return setPhase("idle");
    try {
      // capture the memory window BEFORE appending the new prediction
      const history = activeChatId ? await historyWindow(activeChatId).catch(() => undefined) : undefined;
      const result = await executeLips(clip, history);
      setText(result.response);
      setSteps(result.steps);
      if (activeChatId) {
        try {
          await appendMessage(activeChatId, "self", result.response, result.steps);
        } catch {
          setToast("Couldn't save the prediction to the chat.");
        }
        touch();
      }
      setPhase("review");
    } catch (e) {
      let msg =
        e instanceof Error && e.message && !e.message.startsWith("/api/")
          ? e.message
          : "Something went wrong. Tap Talk to try again.";
      // re-check in case the mount-time health check had not resolved yet
      if (!(await vsrAvailable())) {
        setVsrOk(false);
        msg = "The lip-reading service is unavailable right now - use the Run Agent button instead.";
      }
      setApiError(msg);
      setPhase("idle");
    }
  }

  // word-by-word reveal driven by the audio clock
  function startTick(audio: HTMLAudioElement, tk: SpokenToken[]) {
    const tick = () => {
      let n = 0;
      while (n < tk.length && tk[n].start <= audio.currentTime) n++;
      setSpoken(n);
      if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function speakNow() {
    const existing = audioRef.current;
    if (existing) {
      existing.currentTime = 0;
      setSpoken(0);
      setPhase("speaking");
      existing.play();
      return;
    }
    setPreparing(true);
    setApiError(null);
    try {
      const { audioUrl, tokens: tk } = await speak(text, getStoredVoiceId());
      setTokens(tk);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audioUrlRef.current = audioUrl;
      audio.onplay = () => {
        setPreparing(false);
        setPhase("speaking");
        startTick(audio, tk);
      };
      audio.onended = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setSpoken(tk.length);
        setPhase("review");
      };
      await audio.play();
    } catch {
      setPreparing(false);
      setApiError("Couldn't play the voice.");
    }
  }

  function interrupt() {
    audioRef.current?.pause();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setSpoken(tokens.length);
    setPhase("review");
  }

  const showText = phase === "review" || phase === "speaking";
  const mmss = `${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, "0")}`;

  const btnSize = cameraOn ? "sm" : "md";

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${
        cameraOn ? "bg-black" : "bg-gradient-to-br from-indigo-50 via-white to-violet-100"
      }`}
    >
      {/* -scale-x-100 un-mirrors the front-camera preview (display only) */}
      {cameraOn && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
      )}

      {!cameraOn && (
        <>
          <div className="animate-float-slow pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-violet-200/50 blur-3xl" />
          <div
            className="animate-float-slow pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-indigo-200/45 blur-3xl"
            style={{ animationDelay: "-4s" }}
          />

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto px-5 pt-32 pb-10 text-center sm:gap-4 sm:px-6 sm:py-16">
            <div className="relative">
              <div className="animate-glow-pulse absolute inset-0 rounded-full bg-violet-400/40 blur-2xl" />
              <img
                src="/chaplin_logo.png"
                alt=""
                className="animate-fade-up relative h-16 w-16 drop-shadow-sm sm:h-24 sm:w-24"
                style={{ animationDelay: "0.05s" }}
              />
            </div>
            <h1
              className="animate-fade-up bg-gradient-to-r from-violet-700 via-violet-600 to-indigo-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-5xl"
              style={{ animationDelay: "0.25s" }}
            >
              Chaplin AI
            </h1>

            <p
              className="animate-fade-up mt-3 max-w-xl text-lg font-semibold leading-snug text-gray-800 sm:text-2xl sm:text-3xl"
              style={{ animationDelay: "0.55s" }}
            >
              A communication agent for non-vocal, ventilated patients.
            </p>

            <div className="relative mt-3 w-full max-w-lg text-left">
              <div className="pointer-events-none absolute bottom-6 left-[22px] top-6 w-0.5 bg-gradient-to-b from-violet-300 via-indigo-300 to-blue-300" />
              <div className="space-y-4">
                <TimelineChip icon={<CameraIcon />} tone="violet" delay="0.85s">
                  <p className="text-sm font-medium text-gray-800 sm:text-lg">
                    Chaplin AI <span className="font-semibold text-violet-600">reads your lips</span>{" "}
                    from a short webcam clip,
                  </p>
                </TimelineChip>
                <TimelineChip icon={<BoltIcon />} tone="indigo" delay="1.3s">
                  <StreamWords
                    className="text-sm text-gray-700 sm:text-lg"
                    base={1.5}
                    segments={[
                      { text: "corrects", className: "font-semibold text-indigo-600" },
                      { text: "the noisy transcription with an AI language model," },
                    ]}
                  />
                </TimelineChip>
                <TimelineChip icon={<SpeakerIcon size={17} />} tone="blue" delay="2.35s">
                  <StreamWords
                    className="text-sm text-gray-700 sm:text-lg"
                    base={2.55}
                    segments={[
                      { text: "and" },
                      { text: "speaks the sentence aloud", className: "font-semibold text-blue-600" },
                      { text: "in a natural voice." },
                    ]}
                  />
                </TimelineChip>
              </div>
            </div>
          </div>
        </>
      )}

      {/* dim the camera while a sentence is on screen */}
      {showText && <div className="absolute inset-0 z-10 bg-black/45" />}

      {toast && (
        <div
          className="animate-pop fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full border border-amber-200 bg-white/95 px-4 py-2.5 shadow-[0_8px_28px_rgba(76,29,149,0.18)] backdrop-blur"
          style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
          role="status"
        >
          <WarnIcon className="shrink-0 text-amber-500" />
          <span className="text-sm font-medium text-gray-800">{toast}</span>
        </div>
      )}

      {/* control section, top-right */}
      <div
        className={`absolute right-2 z-30 flex flex-col rounded-2xl border border-white/70 bg-white/60 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[0_8px_28px_rgba(76,29,149,0.15)] sm:right-4 sm:rounded-3xl ${
          cameraOn
            ? "w-36 gap-1 p-1.5 sm:w-44 sm:gap-1.5 sm:p-2"
            : "w-40 gap-1.5 p-1.5 sm:w-60 sm:gap-2.5 sm:p-3"
        }`}
        style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <GlassButton
          size={btnSize}
          onClick={() => setShowAgent(true)}
          variant="primary"
          icon={<BoltIcon className="text-emerald-300" />}
          label="Run Agent"
          className="w-full"
        />
        {cameraOn && (
          <GlassButton
            size={btnSize}
            onClick={() => setShowChat(true)}
            variant="ghost"
            icon={
              <span className="relative text-gray-500">
                <ChatIcon />
                {activeChatId && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-green-500" />
                )}
              </span>
            }
            label="Chat"
            className="w-full"
          />
        )}
        <GlassButton
          size={btnSize}
          onClick={() => setShowAbout(true)}
          variant="ghost"
          icon={<span className="text-gray-500"><InfoIcon /></span>}
          label="Info"
          className="w-full"
        />
        <GlassButton
          size={btnSize}
          onClick={onChangeVoice}
          variant="ghost"
          icon={<span className="text-gray-500"><GearIcon /></span>}
          label="Settings"
          className="w-full"
        />
        <div
          className={`flex w-full items-center justify-between gap-2 rounded-full border border-white/70 bg-white/85 font-semibold text-gray-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_4px_14px_rgba(76,29,149,0.12)] ${
            cameraOn
              ? "px-2.5 py-1 text-xs sm:px-4 sm:py-1 sm:text-sm"
              : "px-3 py-1 text-sm sm:px-5 sm:py-1.5 sm:text-base"
          }`}
        >
          <span className={`flex items-center text-gray-500 ${cameraOn ? "gap-1" : "gap-1.5"} sm:gap-2`}>
            <CameraIcon />
            <span className="text-gray-900">Camera</span>
          </span>
          <Toggle checked={cameraOn} onChange={setCameraOn} small={cameraOn} />
        </div>
      </div>

      {phase === "recording" && (
        <div
          className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 backdrop-blur"
          style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm font-medium text-white">Listening · {mmss}</span>
        </div>
      )}

      {phase === "thinking" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-2xl bg-black/55 p-5 backdrop-blur">
            <Spinner size={32} light />
          </div>
        </div>
      )}

      {showText && (
        <div className="absolute inset-x-0 top-[16%] bottom-[34%] z-20 flex items-center justify-center overflow-y-auto px-6">
          <p className="animate-pop mx-auto max-w-lg text-center text-3xl font-semibold leading-snug text-white drop-shadow-lg">
            {tokens.length > 0
              ? tokens.map((tk, i) => (
                  <span key={i} className={i < spoken ? "opacity-100" : "opacity-40"}>
                    {tk.t}
                  </span>
                ))
              : text}
          </p>
        </div>
      )}

      {/* bottom controls */}
      <div
        className="absolute inset-x-0 bottom-0 z-30 px-5 pt-12"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="mx-auto w-full max-w-sm">
          {(error || apiError) && (
            <p
              className={`mb-3 text-center text-sm font-medium ${
                cameraOn ? "text-red-300" : "text-red-600"
              }`}
            >
              {error || apiError}
            </p>
          )}

          {cameraOn && phase === "idle" && (
            <GlassButton className="w-full" onClick={record} variant="ghost" icon={<RecordDot />} label="Talk" />
          )}

          {phase === "recording" && (
            <GlassButton className="w-full" onClick={finishRecording} variant="danger" icon={<StopIcon />} label="Stop" />
          )}

          {phase === "review" && (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={speakNow}
                disabled={preparing}
                className="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-green-600 py-4 text-xl font-bold text-white shadow-[0_12px_34px_rgba(22,120,60,0.55)] transition hover:bg-green-700 active:scale-[0.98] disabled:opacity-90"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                <span className="relative flex items-center gap-2.5">
                  {preparing ? <Spinner size={24} light /> : <SpeakerIcon size={24} />}
                  {preparing ? "Preparing…" : "Speak"}
                </span>
              </button>
              <GlassButton className="w-full" onClick={record} variant="ghost" icon={<RecordDot />} label="Talk" />
            </div>
          )}

          {phase === "speaking" && (
            <GlassButton className="w-full" onClick={interrupt} variant="danger" icon={<StopIcon />} label="Stop" />
          )}

          {phase === "review" && steps.length > 0 && (
            <button
              onClick={() => setShowTrace(true)}
              className="mx-auto mt-3 block text-center text-xs font-medium text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
            >
              View agent steps ({steps.length})
            </button>
          )}
        </div>
      </div>

      {showAgent && <RunAgentPanel onClose={() => setShowAgent(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showChat && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-gray-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-white/95 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Chat</h2>
                <p className="text-xs text-gray-500">
                  Your lip-read sentences join the selected chat; add what the other person says.
                </p>
              </div>
              <button
                onClick={() => setShowChat(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <ChatPanel />
            </div>
          </div>
        </div>
      )}
      {showTrace && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-gray-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-white/95 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">Steps trace</h2>
              <button
                onClick={() => setShowTrace(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <StepsTrace steps={steps} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GlassButton({
  onClick,
  disabled,
  variant,
  icon,
  label,
  size = "md",
  round = false,
  ariaLabel,
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "danger" | "ghost";
  icon: React.ReactNode;
  label: string;
  size?: "sm" | "md";
  round?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const look = {
    primary:
      "border-white/40 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_24px_rgba(109,40,217,0.35)]",
    ghost:
      "border-white/70 bg-white/85 text-gray-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_4px_14px_rgba(76,29,149,0.12)]",
    danger:
      "border-white/40 bg-red-500/85 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_24px_rgba(220,38,38,0.35)]",
  }[variant];
  const sizing = round
    ? "h-8 w-8 text-sm"
    : size === "sm"
      ? "px-3 py-1 text-xs sm:px-4 sm:py-1.5 sm:text-sm"
      : "px-5 py-1.5 text-sm sm:px-8 sm:py-2.5 sm:text-base";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border font-semibold backdrop-blur-2xl backdrop-saturate-[1.8] transition hover:-translate-y-0.5 active:scale-[0.97] active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 ${sizing} ${look} ${className}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
      <span className={`relative flex items-center gap-1 ${size === "sm" ? "sm:gap-1.5" : "sm:gap-2"}`}>
        {icon}
        {label}
      </span>
    </button>
  );
}

const TONE: Record<string, string> = {
  violet: "bg-violet-100 text-violet-600",
  indigo: "bg-indigo-100 text-indigo-600",
  blue: "bg-blue-100 text-blue-600",
};

function TimelineChip({
  icon,
  tone,
  delay,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  delay: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-up flex items-start gap-4" style={{ animationDelay: delay }}>
      <span
        className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-4 ring-white/90 ${TONE[tone]}`}
      >
        {icon}
      </span>
      <div className="flex-1 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-[0_4px_16px_rgba(76,29,149,0.08)] backdrop-blur">
        {children}
      </div>
    </div>
  );
}

function StreamWords({
  segments,
  base,
  step = 0.12,
  className = "",
}: {
  segments: { text: string; className?: string }[];
  base: number;
  step?: number;
  className?: string;
}) {
  let i = 0;
  return (
    <p className={className}>
      {segments.map((seg, si) =>
        seg.text.split(" ").map((w, wi) => (
          <span
            key={`${si}-${wi}`}
            className={`animate-fade-up inline-block ${seg.className || ""}`}
            style={{ animationDelay: `${(base + i++ * step).toFixed(2)}s` }}
          >
            {w}
            {" "}
          </span>
        ))
      )}
    </p>
  );
}

function Toggle({
  checked,
  onChange,
  small = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  small?: boolean;
}) {
  const track = small ? "h-5 w-9 sm:h-6 sm:w-10" : "h-6 w-10 sm:h-7 sm:w-12";
  const knob = small ? "h-4 w-4 sm:h-5 sm:w-5" : "h-5 w-5 sm:h-6 sm:w-6";
  const shift = small ? "translate-x-4" : "translate-x-4 sm:translate-x-5";
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label="Camera"
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full transition-colors duration-200 ${track} ${
        checked ? "bg-green-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 rounded-full bg-white shadow-md transition-transform duration-200 ${knob} ${
          checked ? shift : ""
        }`}
      />
    </button>
  );
}

/* inline icons */
const RecordDot = () => <span className="h-3 w-3 rounded-full bg-red-500" />;
const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const ChatIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const InfoIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const CameraIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const WarnIcon = ({ className = "" }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const BoltIcon = ({ className = "" }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
const StopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const SpeakerIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
);
