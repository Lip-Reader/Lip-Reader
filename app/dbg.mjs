import { chromium, devices } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await b.newContext({ ...devices["iPhone 13"], permissions: ["camera", "microphone"] });
const p = await ctx.newPage();
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
await p.route("**/health", (r) => r.fulfill({ json: { status: "ok", vsr_available: true } }));
await p.route("**/api/settings/public", (r) => r.fulfill({ json: { default_voice_id: "Brian", lip_reading_enabled: true } }));
await p.goto("http://localhost:5173/talk");
await p.waitForTimeout(4000);
const r = await p.evaluate(async () => {
  try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 }, audio: true }); return { ok: true, tracks: s.getTracks().map(t => t.kind), rec: typeof MediaRecorder, mp4: MediaRecorder.isTypeSupported("video/mp4"), webm: MediaRecorder.isTypeSupported("video/webm") }; } catch (e) { return { err: e.name + ": " + e.message }; }
});
console.log("GUM", JSON.stringify(r));
const btn = await p.getByTestId("talk-button").getAttribute("aria-disabled");
const video = await p.evaluate(() => { const v = document.querySelector("video"); return v ? { has: !!v.srcObject, w: v.videoWidth } : null; });
console.log("btn disabled", btn, "video", JSON.stringify(video));
await b.close();
