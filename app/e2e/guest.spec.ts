import { expect, test } from "@playwright/test";
import { formField, mockBackend, WORD_OPTIONS } from "./mocks";

test.beforeEach(async ({ page }) => mockBackend(page));

test("landing shows Try now and Log in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Chaplin AI")).toBeVisible();
  await expect(page.getByTestId("try-button")).toBeVisible();
  await expect(page.getByTestId("login-button")).toBeVisible();
  await expect(page.getByText("Run Agent")).toHaveCount(0);
});

test("guest talk flow: record, sentence, speak", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => calls.push(r.url()));
  await page.goto("/");
  await page.getByTestId("try-button").click();
  await expect(page).toHaveURL(/\/talk$/);
  await expect(page.getByTestId("settings-button")).toBeVisible();
  await expect(page.getByTestId("admin-button")).toHaveCount(0);
  const talk = page.getByTestId("talk-button");
  await expect(talk).toBeEnabled();
  const before = calls.length;
  await talk.click();
  await expect(page.getByText(/Listening/)).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
  await expect(page.getByTestId("read")).toHaveText("Read: I WOULD LIKE SOME WHAT ER");
  const between = calls.slice(before).filter((u) => !u.includes("localhost:517"));
  expect(between.filter((u) => u.includes("/api/execute_lips"))).toHaveLength(1);
  expect(between.filter((u) => u.includes("/api/execute_lips") || u.includes("/speak"))).toHaveLength(1);
  await page.getByTestId("speak-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
});

test("listening: what the browser heard shows under the sentence and is logged; Settings turns it off", async ({ page }) => {
  await page.addInitScript(() => {
    // newer Chromium ships the unprefixed name too; the app takes whichever exists first
    (window as any).SpeechRecognition = (window as any).webkitSpeechRecognition = class {
      onresult?: (e: unknown) => void;
      onend?: () => void;
      start() {
        (window as any).__listening = true;
      }
      stop() {
        this.onresult?.({ results: [[{ transcript: "I would like some water" }]] });
        this.onend?.();
      }
    };
  });
  const runs: unknown[] = [];
  await page.route("**/api/runs", (r) => {
    runs.push(r.request().postDataJSON());
    r.fulfill({ json: { id: 1 } });
  });
  const record = async () => {
    await page.goto("/talk");
    const talk = page.getByTestId("talk-button");
    await expect(talk).toBeEnabled();
    await talk.click();
    await page.waitForTimeout(600);
    await page.getByTestId("stop-button").click();
    await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
  };

  await record();
  await expect(page.getByTestId("heard")).toHaveText("Heard: I would like some water");
  await expect.poll(() => runs).toEqual([expect.objectContaining({ heard: "I would like some water" })]);

  await page.goto("/settings");
  await page.getByTestId("listen-off").click();
  await record();
  await expect(page.getByTestId("heard")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__listening)).toBeUndefined();
  await expect.poll(() => runs).toHaveLength(2);
  expect(runs[1]).toEqual(expect.objectContaining({ heard: null }));
});

test("guest voice choice persists locally without /api/me/settings", async ({ page }) => {
  const settingsCalls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/me/settings") && settingsCalls.push(r.url()));
  await page.goto("/settings");
  await page.getByText("Ashley", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Ashley/ })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Ashley/ })).toHaveAttribute("aria-checked", "true");
  expect(settingsCalls).toHaveLength(0);
});

test("admin route is locked for signed-out visitors", async ({ page }) => {
  const adminCalls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/admin") && adminCalls.push(r.url()));
  await page.goto("/admin");
  await expect(page.getByText(/Sign in to continue|Admin is unavailable/)).toBeVisible();
  expect(adminCalls).toHaveLength(0);
});

test("voice list shows five voices, then more on demand", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("radio")).toHaveCount(5);
  await page.getByRole("button", { name: /Show more/ }).click();
  await expect(page.getByRole("radio")).toHaveCount(8);
});

test("default voice is marked when nothing was chosen", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: /Brian/ })).toHaveAttribute("aria-checked", "true");
});

const HEBREW_SETTINGS = { voice_id: "Yael", language: "he", gender: "m", patient_key: "test-patient-key" };

test("hebrew: language toggle shows the phrase list and persists locally", async ({ page }) => {
  const settingsCalls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/me/settings") && settingsCalls.push(r.url()));
  await page.goto("/settings");
  await page.getByTestId("lang-he").click();
  await expect(page.getByTestId("group-pain")).toBeVisible();
  await expect(page.getByTestId("phrase-basics_yes")).toBeVisible();
  await expect(page.getByTestId("phrase-progress")).toHaveText(/1 מתוך 100 משפטים נלמדו/);
  await page.getByTestId("group-pain").click();
  await expect(page.getByTestId("phrase-pain_hurts")).toContainText("2/3");
  await page.getByTestId("phrase-search").fill("צמא");
  await expect(page.getByTestId("phrase-needs_thirsty")).toBeVisible();
  await expect(page.getByTestId("phrase-pain_hurts")).toHaveCount(0);
  await page.getByTestId("gender-f").click();
  await expect(page.getByTestId("phrase-needs_thirsty")).toContainText("אני צמאה");
  await page.reload();
  await expect(page.getByTestId("group-pain")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Yael|Oren/ })).toHaveCount(2);
  expect(settingsCalls).toHaveLength(0);
});

test("hebrew: enrolling a phrase sends the take and updates the badge", async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem("chaplin_settings", JSON.stringify(s)), HEBREW_SETTINGS);
  const enrolls: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/enroll_phrase")) return;
    enrolls.push(r.postDataBuffer()?.toString("latin1") ?? "");
  });
  await page.goto("/settings");
  await page.getByTestId("group-pain").click();
  await page.getByTestId("phrase-pain_hurts").click();
  await expect(page.getByTestId("enroll-back")).toBeVisible();
  await expect(page.getByTestId("enroll-phrase")).toHaveText("כואב לי");
  await expect(page.getByTestId("enroll-status")).toHaveText(/לקיחה 3 מתוך 3/);
  const previewBox = await page.locator("video").first().boundingBox();
  expect(previewBox?.height ?? 0).toBeGreaterThanOrEqual(380);
  const record = page.getByTestId("enroll-record");
  await expect(record).toBeEnabled();
  await record.click();
  await page.waitForTimeout(600);
  await page.getByTestId("enroll-stop").click();
  await expect(page.getByTestId("enroll-status")).toHaveText(/נלמד עם 3 הקלטות/);
  expect(enrolls).toHaveLength(1);
  expect(enrolls[0]).toContain('name="patient_key"\r\n\r\ntest-patient-key');
  expect(enrolls[0]).toContain('name="phrase_id"\r\n\r\npain_hurts');
  await page.getByTestId("enroll-back").click();
  await expect(page.getByTestId("phrase-pain_hurts")).toContainText("3/3");
});

test("hebrew: talk shows candidates when unsure and speaks the chosen one", async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem("chaplin_settings", JSON.stringify(s)), HEBREW_SETTINGS);
  const runs: unknown[] = [];
  await page.route("**/api/runs", (r) => {
    runs.push(r.request().postDataJSON());
    r.fulfill({ json: { id: 1 } });
  });
  await page.goto("/talk");
  const talk = page.getByTestId("talk-button");
  await expect(talk).toBeEnabled();
  await talk.click();
  await page.waitForTimeout(600);
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("candidate-0")).toHaveText("כואב לי");
  await expect(page.getByTestId("candidate-2")).toHaveText("אני צמא");
  await expect(page.getByTestId("candidate-none")).toBeVisible();
  await page.getByTestId("candidate-1").click();
  await expect(page.getByTestId("sentence")).toHaveText("כואב לי הראש");
  await page.getByTestId("speak-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("כואב לי הראש");
  expect(runs).toEqual([expect.objectContaining({ corrected: "כואב לי הראש", raw: "pain_hurts", truth: "pain_head", hebrew: expect.objectContaining({ confident: false }) })]);

  await expect(page.getByTestId("reset-button")).toBeVisible();
  await page.getByTestId("reset-button").click();
  await expect(page.getByTestId("sentence")).toHaveCount(0);
  await expect(page.getByTestId("reset-button")).toHaveCount(0);
  await expect(page.getByTestId("talk-button")).toHaveText("דבר");
});

test("hebrew: buttons and chrome text switch to Hebrew", async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem("chaplin_settings", JSON.stringify(s)), HEBREW_SETTINGS);
  await page.goto("/settings");
  await expect(page.getByText("הגדרות").first()).toBeVisible();
  await expect(page.getByText("🎙️ קול")).toBeVisible();
  await expect(page.getByText("💬 משוב")).toBeVisible();

  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toHaveText("דבר");
  await page.getByTestId("talk-button").click();
  await page.waitForTimeout(600);
  await page.getByTestId("stop-button").click();
  await page.getByTestId("candidate-1").click();
  await expect(page.getByTestId("speak-button")).toContainText("השמע");
});

test("flip camera switches to the back camera and remembers it", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const calls: MediaStreamConstraints[] = [];
    (window as unknown as { __gum: MediaStreamConstraints[] }).__gum = calls;
    navigator.mediaDevices.getUserMedia = (c: MediaStreamConstraints) => {
      calls.push(c);
      return orig(c);
    };
  });
  const facingOf = (i: number) =>
    page.evaluate((k) => {
      const calls = (window as unknown as { __gum: { video: { facingMode: string } }[] }).__gum;
      return calls.at(k)?.video.facingMode;
    }, i);
  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  expect(await facingOf(-1)).toBe("user");
  // the preview carries data-facing; the recorder's hidden detector video does not
  const preview = page.locator("video[data-facing]");
  await expect(preview).toHaveAttribute("data-facing", "front");
  await page.getByTestId("flip-camera-button").click();
  await expect(preview).toHaveAttribute("data-facing", "back");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  expect(await facingOf(-1)).toBe("environment");
  expect(await preview.evaluate((v) => getComputedStyle(v).transform)).toBe("none");
  await page.getByTestId("talk-button").click();
  await expect(page.getByTestId("flip-camera-button")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toBeVisible();
  await page.reload();
  await expect(page.locator("video[data-facing]")).toHaveAttribute("data-facing", "back");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  expect(await facingOf(-1)).toBe("environment");
});

test("the run log carries the word options, the clip length reaches the service", async ({ page }) => {
  const runs: Record<string, unknown>[] = [];
  await page.route("**/api/runs", (r) => {
    runs.push(r.request().postDataJSON());
    r.fulfill({ json: { id: 1 } });
  });
  const fields: Record<string, string | null> = {};
  page.on("request", (r) => {
    if (r.url().includes("/api/execute_lips")) {
      const body = r.postDataBuffer()?.toString("latin1") ?? "";
      for (const name of ["duration_ms", "examples", "notes"]) {
        const m = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body);
        fields[name] = m ? Buffer.from(m[1], "latin1").toString("utf8") : null;
      }
    }
  });
  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  await page.getByTestId("talk-button").click();
  await page.waitForTimeout(800);
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
  expect(Number(fields.duration_ms)).toBeGreaterThan(500);
  expect(fields.examples).toBeNull();
  expect(fields.notes).toBeNull();
  await expect.poll(() => runs).toEqual([
    expect.objectContaining({ raw: "I WOULD LIKE SOME WHAT ER", word_options: WORD_OPTIONS, clip_fps: 30, truth: null }),
  ]);
});

test("teach: a confirmed sentence becomes an example the next clip carries", async ({ page }) => {
  const runs: Record<string, unknown>[] = [];
  await page.route("**/api/runs", (r) => {
    runs.push(r.request().postDataJSON());
    r.fulfill({ json: { id: 1 } });
  });
  const examples: (string | null)[] = [];
  await page.route("**/api/execute_lips", async (r) => {
    examples.push(formField(r, "examples"));
    await r.fallback();
  });
  await page.goto("/settings");
  await expect(page.getByTestId("teach-count")).toHaveText(/0 examples saved/);
  const record = page.getByTestId("teach-record");
  await expect(record).toBeEnabled();
  await record.click();
  await page.waitForTimeout(600);
  await page.getByTestId("teach-stop").click();
  await expect(page.getByTestId("teach-read")).toHaveText("Read: I WOULD LIKE SOME WHAT ER");
  await expect(page.getByTestId("teach-chaplin")).toHaveText("Chaplin: I would like some water.");
  await page.getByTestId("teach-no").click();
  await page.getByTestId("teach-fix").fill("I would like some water, please.");
  await page.getByTestId("teach-save").click();
  await expect(page.getByTestId("teach-count")).toHaveText(/1 examples saved/);
  await expect.poll(() => runs).toEqual([expect.objectContaining({ truth: "I would like some water, please.", word_options: WORD_OPTIONS })]);
  expect(examples).toEqual([null]);

  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  await page.getByTestId("talk-button").click();
  await page.waitForTimeout(600);
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
  expect(JSON.parse(examples[1] ?? "[]")).toEqual([{ phrase: "I would like some water, please.", model_output: WORD_OPTIONS }]);

  await page.goto("/settings");
  await page.getByTestId("teach-delete-0").click();
  await expect(page.getByTestId("teach-count")).toHaveText(/0 examples saved/);
});

test("notes: a note about the patient goes to the corrector with every clip", async ({ page }) => {
  const notes: (string | null)[] = [];
  await page.route("**/api/execute_lips", async (r) => {
    notes.push(formField(r, "notes"));
    await r.fallback();
  });
  await page.goto("/settings");
  await page.getByTestId("note-add").click();
  await page.getByTestId("note-input").fill("He keeps bees and sells honey");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("note-0")).toContainText("He keeps bees and sells honey");
  await page.reload();
  await expect(page.getByTestId("note-0")).toContainText("He keeps bees and sells honey");

  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  await page.getByTestId("talk-button").click();
  await page.waitForTimeout(600);
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toBeVisible();
  expect(JSON.parse(notes[0] ?? "[]")).toEqual(["He keeps bees and sells honey"]);

  await page.goto("/settings");
  await page.getByTestId("note-delete-0").click();
  await expect(page.getByTestId("note-0")).toHaveCount(0);
});

test("hebrew: the phrase list shows each phrase's standing and the self-test", async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem("chaplin_settings", JSON.stringify(s)), HEBREW_SETTINGS);
  await page.goto("/settings");
  await expect(page.getByTestId("phrase-self-test")).toHaveText("בדיקה עצמית: 2/2 נכון, שלושת הראשונים 2/2");
  await page.getByTestId("group-pain").click();
  await expect(page.getByTestId("phrase-pain_hurts")).toContainText("תקין");
  await page.getByTestId("phrase-pain_hurts").click();
  await page.getByTestId("enroll-record").click();
  await page.waitForTimeout(600);
  await page.getByTestId("enroll-stop").click();
  await expect(page.getByTestId("enroll-verdict")).toHaveText("תקין (3/3)");
  await page.getByTestId("enroll-drop").click();
  await expect(page.getByTestId("enroll-status")).toHaveText(/לקיחה 2 מתוך 3/);
});

test("desktop: the talk screen sits in a phone-sized frame, not the whole window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/talk");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  // the camera fills a 480px frame (a hairline border inside it), centred in the window
  const video = await page.locator("video[data-facing]").boundingBox();
  expect(video?.width).toBeGreaterThanOrEqual(476);
  expect(video?.width).toBeLessThanOrEqual(480);
  expect(video?.height).toBeLessThanOrEqual(752);
  expect(video?.x).toBeGreaterThanOrEqual(400);
  expect(video?.x).toBeLessThanOrEqual(402);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.locator("video[data-facing]").boundingBox())?.width).toBe(390);
});
