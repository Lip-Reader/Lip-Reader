import { test } from "@playwright/test";
import { mockBackend } from "./mocks";

const OUT = process.env.SHOTS_DIR || "screenshots";
const SIZES = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`screenshots ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockBackend(page, { admin: true });
    await page.goto("http://localhost:5173/");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/landing-${size}.png` });
    await page.goto("/talk");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/talk-${size}.png` });
    await page.getByTestId("talk-button").click();
    await page.waitForTimeout(600);
    await page.getByTestId("stop-button").click();
    await page.getByTestId("speak-button").waitFor();
    await page.screenshot({ path: `${OUT}/talk-review-${size}.png` });
    await page.goto("/settings");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/settings-${size}.png` });
    await page.goto("/admin");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/admin-overview-${size}.png` });
    await page.getByTestId("admin-nav-users").click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/admin-users-${size}.png` });
    await page.getByTestId("admin-nav-info").click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/admin-info-${size}.png` });
  });
}
