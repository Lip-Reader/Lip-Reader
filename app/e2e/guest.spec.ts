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
