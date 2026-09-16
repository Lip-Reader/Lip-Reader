import { defineConfig, devices } from "@playwright/test";

const fakeMedia = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", launchOptions: { args: fakeMedia }, permissions: ["camera", "microphone"] },
  projects: [
    { name: "guest", testMatch: /guest\.spec\.ts/, use: { baseURL: "http://localhost:5173" } },
    { name: "admin", testMatch: /admin\.spec\.ts/, use: { baseURL: "http://localhost:5174" } },
    { name: "shots", testMatch: /shots\.spec\.ts/, use: { baseURL: "http://localhost:5174" } },
  ],
  webServer: [
    { command: "npx expo start --web --port 5173", url: "http://localhost:5173", reuseExistingServer: true, timeout: 120_000 },
    {
      command: "npx expo start --web --port 5174 --clear",
      url: "http://localhost:5174",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { EXPO_PUBLIC_FORCE_ADMIN: "1", EXPO_PUBLIC_API_BASE: "http://localhost:8000" },
    },
  ],
});
