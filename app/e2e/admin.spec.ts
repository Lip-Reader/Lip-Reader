import { expect, test } from "@playwright/test";
import { mockBackend } from "./mocks";

test.beforeEach(async ({ page }) => mockBackend(page, { admin: true }));

test("admin sees the admin button and every section loads", async ({ page }) => {
  await page.goto("/talk");
  await expect(page.getByTestId("admin-button")).toBeVisible();
  await page.getByTestId("admin-button").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Runs (24h)")).toBeVisible();
  await page.getByTestId("admin-nav-users").click();
  await expect(page.getByText("adam@example.com")).toBeVisible();
  await page.getByTestId("admin-nav-logs").click();
  await expect(page.getByText("settings.patch")).toBeVisible();
  await page.getByText("Runs", { exact: true }).click();
  await expect(page.getByText("I WOULD LIKE SOME WHAT ER")).toBeVisible();
  await page.getByTestId("admin-nav-settings").click();
  await expect(page.getByText("Default voice")).toBeVisible();
  await page.getByTestId("admin-nav-support").click();
  await expect(page.getByText(/Could it also read slower/)).toBeVisible();
  await page.getByTestId("admin-nav-info").click();
  await expect(page.getByText("Endpoints")).toBeVisible();
  await expect(page.getByText("Jonathan Eshel")).toBeVisible();
});

for (const on of [false, true]) {
  test(`admin ${on ? "sees" : "does not see"} the Read line with the flag ${on ? "on" : "off"}`, async ({ page }) => {
    await page.route("**/api/settings/public", (r) => r.fulfill({ json: { default_voice_id: "Brian", lip_reading_enabled: true, show_vsr_output: on } }));
    await page.goto("/talk");
    await page.getByTestId("talk-button").click();
    await expect(page.getByText(/Listening/)).toBeVisible();
    await page.waitForTimeout(800);
    await page.getByTestId("stop-button").click();
    await expect(page.getByTestId("sentence")).toHaveText("I would like some water.");
    if (on) await expect(page.getByTestId("read")).toHaveText("Read: I WOULD LIKE SOME WHAT ER");
    else await expect(page.getByTestId("read")).toHaveCount(0);
  });
}

test("saving admin settings sends a PATCH", async ({ page }) => {
  let patched: unknown = null;
  await page.route("**/api/admin/settings", (r) => {
    if (r.request().method() === "PATCH") patched = r.request().postDataJSON();
    r.fulfill({ json: { settings: { default_voice_id: "Ashley", lip_reading_enabled: true, show_vsr_output: false } } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-settings").click();
  await page.getByText("Ashley", { exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  expect(patched).toEqual({ default_voice_id: "Ashley", lip_reading_enabled: true, show_vsr_output: false });
});
