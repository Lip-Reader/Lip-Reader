export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || (__DEV__ ? "http://localhost:8000" : "");

export const VSR_BASE =
  process.env.EXPO_PUBLIC_VSR_API_BASE ||
  (__DEV__ ? "http://localhost:8001" : "https://adamsi--chaplin-ai-backend.modal.run");

export type Voice = { id: string; name: string; description?: string; gender?: string };
export type Step = { module: string; prompt: Record<string, unknown>; response: Record<string, unknown> };
export type ExecuteResult = { response: string; steps: Step[]; raw: string };
export type SpokenToken = { t: string; start: number };
export type ClipFile = Blob | { uri: string; name: string; type: string };
export type PublicSettings = { default_voice_id: string; lip_reading_enabled: boolean };
export type UserSettings = { voice_id: string | null };

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

export async function executeLips(clip: ClipFile): Promise<ExecuteResult> {
  const form = new FormData();
  if (clip instanceof Blob) {
    form.append("file", clip, clip.type.includes("webm") ? "clip.webm" : "clip.mp4");
  } else {
    form.append("file", clip as unknown as Blob);
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
  if (data.status !== "ok" || !data.response) throw new Error(data.error || "lip reading failed");
  const steps: Step[] = data.steps || [];
  const raw = String(steps.find((s) => s.module === "vsr")?.response?.raw_transcription ?? "");
  return { response: data.response, steps, raw };
}

export async function speak(text: string, voiceId: string): Promise<{ audioUri: string; tokens: SpokenToken[] }> {
  const data = await request<{ audio: string; mime?: string; tokens?: SpokenToken[] }>(
    API_BASE,
    "/speak",
    json({ text, voice_id: voiceId })
  );
  return { audioUri: `data:${data.mime || "audio/mpeg"};base64,${data.audio}`, tokens: data.tokens || [] };
}

export const getVoices = () => request<{ voices: Voice[] }>(API_BASE, "/voices").then((d) => d.voices);
export const selectVoice = (voiceId: string) => request(API_BASE, "/voice/select", json({ voice_id: voiceId }));

export async function enrollVoice(clip: ClipFile): Promise<string> {
  const form = new FormData();
  form.append("file", clip as Blob, "voice.mp4");
  const data = await request<{ voice_id: string }>(API_BASE, "/voice/enroll", { method: "POST", body: form });
  return data.voice_id;
}

export const getPublicSettings = () => request<PublicSettings>(API_BASE, "/api/settings/public");
export const getMySettings = (token: Token) => request<UserSettings>(API_BASE, "/api/me/settings", {}, token);
export const putMySettings = (token: Token, voiceId: string) =>
  request<UserSettings>(API_BASE, "/api/me/settings", json({ voice_id: voiceId }, "PUT"), token);
export const sendSupport = (token: Token, message: string) =>
  request<{ id: number }>(API_BASE, "/api/support", json({ message }), token);
export const logRun = (token: Token, raw: string, corrected: string, latencyMs: number) =>
  request(API_BASE, "/api/runs", json({ raw, corrected, latency_ms: latencyMs }), token).catch(() => {});

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
  corrected: string;
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
