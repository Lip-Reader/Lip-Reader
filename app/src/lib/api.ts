export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || (__DEV__ ? "http://localhost:8000" : "");

export const VSR_BASE =
  process.env.EXPO_PUBLIC_VSR_API_BASE ||
  (__DEV__ ? "http://localhost:8001" : "https://adamsi--chaplin-ai-backend.modal.run");

export type Voice = { id: string; name: string; description?: string; gender?: string };
export type Step = { module: string; prompt: Record<string, unknown>; response: Record<string, unknown> };
export type Language = "en" | "he";
export type Gender = "m" | "f";
export type Candidate = { id: string; text: string; score: number };
/** A confirmed sentence and the word options the model produced for it (learning mode). */
export type Example = { phrase: string; model_output: string };
/** The Hebrew matcher's full ranking: [phrase id, score, encoder distance, lip distance]. */
export type HebrewResult = { ranked: [string, number, number, number][]; confident: boolean };
export type ExecuteResult = {
  response: string;
  steps: Step[];
  /** the model's top-1 reading (English) or the best phrase id (Hebrew) */
  raw: string;
  /** the per-word options string the corrector saw; "" in Hebrew mode */
  wordOptions: string;
  clipFps: number | null;
  confident?: boolean;
  candidates?: Candidate[];
  hebrew?: HebrewResult;
};
export type ExecuteOptions = {
  language?: Language;
  patientKey?: string | null;
  gender?: Gender;
  durationMs?: number;
  examples?: Example[];
  notes?: string[];
};
export type Phrase = { id: string; group: string; text_m: string; text_f: string };
export type PhraseBank = { language: string; version: number; groups: { id: string; title: string }[]; phrases: Phrase[] };
export type PhraseStatus = { code: "ok" | "one_take" | "confused"; other: string | null };
export type Verdict = { code: "first_take" | "ok" | "confused"; other: string | null; takes: number };
export type SelfTest = { n: number; top1: number; top3: number };
export type PhraseTemplates = {
  takes: Record<string, number>;
  status_by_phrase: Record<string, PhraseStatus>;
  self_test: SelfTest | null;
  storage: boolean;
};

/** An error from the lip-reading service, with its code when it sent one
 *  (no_face, nothing_read, still, no_rest, not_enrolled). */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}
export type SpokenToken = { t: string; start: number };
export type ClipFile = Blob | { uri: string; name: string; type: string };
export type PublicSettings = { default_voice_id: string; lip_reading_enabled: boolean };
export type UserSettings = { voice_id: string | null; language: Language | null; gender: Gender | null; patient_key: string | null };

type Token = string | null | undefined;

async function request<T>(base: string, path: string, init: RequestInit = {}, token?: Token): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function warmBackend(): void {
  fetch(`${API_BASE}/health`).catch(() => {});
  fetch(`${VSR_BASE}/health`).catch(() => {});
}

export async function pingVsr(timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return (await fetch(`${VSR_BASE}/health`, { signal: ctl.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function vsrAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${VSR_BASE}/health`);
    if (!res.ok) return true;
    return (await res.json()).vsr_available !== false;
  } catch {
    return true;
  }
}

function clipForm(clip: ClipFile): FormData {
  const form = new FormData();
  if (clip instanceof Blob) {
    form.append("file", clip, clip.type.includes("webm") ? "clip.webm" : "clip.mp4");
  } else {
    form.append("file", clip as unknown as Blob);
  }
  return form;
}

export async function executeLips(clip: ClipFile, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const form = clipForm(clip);
  if (opts.durationMs) form.append("duration_ms", String(opts.durationMs));
  if (opts.language === "he") {
    form.append("language", "he");
    if (opts.patientKey) form.append("patient_key", opts.patientKey);
    form.append("gender", opts.gender ?? "m");
  } else {
    if (opts.examples?.length) form.append("examples", JSON.stringify(opts.examples));
    if (opts.notes?.length) form.append("notes", JSON.stringify(opts.notes));
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180_000);
  let res: Response;
  try {
    res = await fetch(`${VSR_BASE}/api/execute_lips`, { method: "POST", body: form, signal: ctl.signal });
  } catch (e) {
    throw new Error(
      e instanceof DOMException && e.name === "AbortError"
        ? "The lip-reading service did not respond. It may still be starting up - try again."
        : "Could not reach the lip-reading service."
    );
  } finally {
    clearTimeout(t);
  }
  if (res.status === 413) throw new Error("Recording too large. Try a shorter clip.");
  if (!res.ok) throw new Error(`/api/execute_lips failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "ok" || !data.response) throw new ApiError(data.error || "lip reading failed", data.code);
  const steps: Step[] = data.steps || [];
  const vsr = steps.find((s) => s.module === "vsr")?.response ?? {};
  const candidates: Candidate[] | undefined = data.candidates;
  const fps = vsr.fps ?? steps.find((s) => s.module === "vsr")?.prompt?.fps;
  return {
    response: data.response,
    steps,
    raw: candidates ? candidates[0]?.id ?? "" : String(vsr.model ?? ""),
    wordOptions: String(vsr.word_options ?? ""),
    clipFps: typeof fps === "number" ? fps : null,
    confident: data.confident,
    candidates,
    hebrew: data.hebrew,
  };
}

export const getPhrases = (lang: Language) => request<PhraseBank>(API_BASE, `/api/phrases/${lang}`);

export async function getPhraseTemplates(patientKey: string): Promise<PhraseTemplates> {
  const d = await request<PhraseTemplates & { status: string; error?: string }>(
    VSR_BASE,
    `/api/phrase_templates?patient_key=${encodeURIComponent(patientKey)}`
  );
  if (d.status !== "ok") throw new Error(d.error || "Couldn't load your phrases.");
  return d;
}

export async function enrollPhrase(
  clip: ClipFile, patientKey: string, phraseId: string, durationMs?: number,
): Promise<{ takes: number; verdict: Verdict }> {
  const form = clipForm(clip);
  form.append("patient_key", patientKey);
  form.append("phrase_id", phraseId);
  if (durationMs) form.append("duration_ms", String(durationMs));
  const d = await request<{ status: string; error?: string; code?: string; takes: number; verdict: Verdict }>(
    VSR_BASE, "/api/enroll_phrase", { method: "POST", body: form },
  );
  if (d.status !== "ok") throw new ApiError(d.error || "Couldn't save that take.", d.code);
  return { takes: d.takes, verdict: d.verdict };
}

/** Drop the newest take of one phrase (the reference's BACKSPACE). */
export async function dropLastTake(patientKey: string, phraseId: string): Promise<{ takes: number }> {
  const d = await request<{ status: string; error?: string; code?: string; takes: number }>(
    VSR_BASE,
    `/api/phrase_templates?patient_key=${encodeURIComponent(patientKey)}&phrase_id=${encodeURIComponent(phraseId)}&last=1`,
    { method: "DELETE" },
  );
  if (d.status !== "ok") throw new ApiError(d.error || "Couldn't drop that take.", d.code);
  return { takes: d.takes };
}

export async function resetPhraseTemplates(patientKey: string): Promise<void> {
  const d = await request<{ status: string; error?: string; deleted: number }>(
    VSR_BASE,
    `/api/phrase_templates?patient_key=${encodeURIComponent(patientKey)}`,
    { method: "DELETE" }
  );
  if (d.status !== "ok") throw new Error(d.error || "Couldn't reset your phrases.");
}

export async function speak(text: string, voiceId: string): Promise<{ audioUri: string; tokens: SpokenToken[] }> {
  const data = await request<{ audio: string; mime?: string; tokens?: SpokenToken[] }>(
    API_BASE,
    "/speak",
    json({ text, voice_id: voiceId })
  );
  return { audioUri: `data:${data.mime || "audio/mpeg"};base64,${data.audio}`, tokens: data.tokens || [] };
}

export const getVoices = (lang: Language = "en") =>
  request<{ voices: Voice[] }>(API_BASE, lang === "en" ? "/voices" : `/voices?lang=${lang}`).then((d) => d.voices);
export const selectVoice = (voiceId: string) => request(API_BASE, "/voice/select", json({ voice_id: voiceId }));

export async function enrollVoice(clip: ClipFile): Promise<string> {
  const form = new FormData();
  form.append("file", clip as Blob, "voice.mp4");
  const data = await request<{ voice_id: string }>(API_BASE, "/voice/enroll", { method: "POST", body: form });
  return data.voice_id;
}

export const getPublicSettings = () => request<PublicSettings>(API_BASE, "/api/settings/public");
export const getMySettings = (token: Token) => request<UserSettings>(API_BASE, "/api/me/settings", {}, token);
export const putMySettings = (token: Token, patch: Partial<UserSettings>) =>
  request<UserSettings>(API_BASE, "/api/me/settings", json(patch, "PUT"), token);
export const sendSupport = (token: Token, message: string) =>
  request<{ id: number }>(API_BASE, "/api/support", json({ message }), token);
/** One line per recording, like the reference's runs.jsonl: the reading, the word
 *  options, the result, the notes the corrector saw, and what was actually said when known. */
export type RunLog = {
  raw: string;
  corrected: string;
  latencyMs: number;
  framing?: unknown;
  heard?: string;
  wordOptions?: string;
  notes?: string[];
  clipFps?: number | null;
  truth?: string | null;
  hebrew?: HebrewResult | null;
};
export const logRun = (token: Token, run: RunLog) =>
  request(API_BASE, "/api/runs",
    json({
      raw: run.raw, corrected: run.corrected, latency_ms: run.latencyMs,
      framing: run.framing ?? null, heard: run.heard || null,
      word_options: run.wordOptions || null, notes: run.notes ?? null,
      clip_fps: run.clipFps ?? null, truth: run.truth ?? null, hebrew: run.hebrew ?? null,
    }),
    token).catch(() => {});

export type AdminOverview = {
  users: number;
  settings_rows: number;
  support_open: number;
  runs_24h: number;
  api_ok: boolean;
  vsr_ok: boolean;
  db_ok: boolean;
};
export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  voice_id: string | null;
};
export type AdminSettings = { default_voice_id: string; lip_reading_enabled: boolean };
export type SupportMessage = {
  id: number;
  user_id: string | null;
  email: string | null;
  message: string;
  status: "open" | "closed";
  created_at: string;
};
export type AuditEntry = { id: number; actor: string; action: string; detail: unknown; created_at: string };
export type RunEntry = {
  id: number;
  user_id: string | null;
  raw: string;
  word_options: string | null;
  corrected: string;
  truth: string | null;
  heard: string | null;
  latency_ms: number | null;
  created_at: string;
};

export const admin = {
  overview: (t: Token) => request<AdminOverview>(API_BASE, "/api/admin/overview", {}, t),
  users: (t: Token) => request<{ users: AdminUser[] }>(API_BASE, "/api/admin/users", {}, t).then((d) => d.users),
  settings: (t: Token) => request<{ settings: AdminSettings }>(API_BASE, "/api/admin/settings", {}, t).then((d) => d.settings),
  patchSettings: (t: Token, patch: Partial<AdminSettings>) =>
    request<{ settings: AdminSettings }>(API_BASE, "/api/admin/settings", json(patch, "PATCH"), t).then((d) => d.settings),
  support: (t: Token) => request<{ messages: SupportMessage[] }>(API_BASE, "/api/admin/support", {}, t).then((d) => d.messages),
  setSupportStatus: (t: Token, id: number, status: "open" | "closed") =>
    request(API_BASE, `/api/admin/support/${id}`, json({ status }, "PATCH"), t),
  audit: (t: Token) => request<{ entries: AuditEntry[] }>(API_BASE, "/api/admin/audit?limit=100", {}, t).then((d) => d.entries),
  runs: (t: Token) => request<{ runs: RunEntry[] }>(API_BASE, "/api/admin/runs?limit=100", {}, t).then((d) => d.runs),
  teamInfo: () => request<{ team_name: string; students: { name: string; email: string }[] }>(API_BASE, "/api/team_info"),
  agentInfo: () =>
    request<{ description: string; purpose: string; prompt_template: { template: string }; prompt_examples: unknown[] }>(
      API_BASE,
      "/api/agent_info"
    ),
  architectureUrl: `${API_BASE}/api/model_architecture`,
};
