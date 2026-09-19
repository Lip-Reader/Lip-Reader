import { expect, test } from "@playwright/test";
import { mockBackend } from "./mocks";

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
  const between = calls.slice(before).filter((u) => !u.includes("localhost:517"));
  expect(between.filter((u) => u.includes("/api/execute_lips"))).toHaveLength(1);
  expect(between.filter((u) => u.includes("/api/execute_lips") || u.includes("/speak"))).toHaveLength(1);
  await page.getByTestId("speak-button").click();
  await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
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
  expect(runs).toEqual([expect.objectContaining({ corrected: "כואב לי הראש", raw: expect.stringContaining("pain_hurts:0.31") })]);

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
  await expect(page.locator("video")).toHaveAttribute("data-facing", "front");
  await page.getByTestId("flip-camera-button").click();
  await expect(page.locator("video")).toHaveAttribute("data-facing", "back");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  expect(await facingOf(-1)).toBe("environment");
  expect(await page.locator("video").evaluate((v) => getComputedStyle(v).transform)).toBe("none");
  await page.getByTestId("talk-button").click();
  await expect(page.getByTestId("flip-camera-button")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("sentence")).toBeVisible();
  await page.reload();
  await expect(page.locator("video")).toHaveAttribute("data-facing", "back");
  await expect(page.getByTestId("talk-button")).toBeEnabled();
  expect(await facingOf(-1)).toBe("environment");
});
