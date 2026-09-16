import type { Page } from "@playwright/test";

const SILENT_MP3 =
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInluyfoCMHVrzJVq4xrKzZoQEa3p/bAGZk2g//tQxAsCpA5pRFTiUOB6EiUoPmDGl1u5hEIRQIbRjoAZBaWDHEUYcKyU3fFgAlEEK6wI/1aSMcA6P22FKk0mPo6QkiALAyLLXP8DtEWFLpx9ka2r31/dlDdXpPz+9sWbaQ5tRUShEmPDgqLIiLqGx0Ub8Ol2sjVqS+F3SAB3Dnmw0BCmTJGT48qbudckC7ugdBAxIIThxNLxOGDW2NJLcAlyTeMoJvpY4xXJIqkGpFAImrfAfg5LNIIhFwmzuWJm2mE1L3ZAjAyf6Vqs5s0NA5iY2UwAQ5ZZ2rSy0K7VhLNa9AG9LPA=";

export async function mockBackend(page: Page, opts: { admin?: boolean } = {}) {
  await page.route("**/health", (r) => r.fulfill({ json: { status: "ok", vsr_available: true } }));
  await page.route("**/api/settings/public", (r) => r.fulfill({ json: { default_voice_id: "Brian", lip_reading_enabled: true } }));
  await page.route("**/voices", (r) =>
    r.fulfill({
      json: {
        voices: [
          { id: "Brian", name: "Brian", description: "Warm male voice", gender: "male" },
          { id: "Ashley", name: "Ashley", description: "Clear female voice", gender: "female" },
          { id: "Noah", name: "Noah", description: "Calm and steady", gender: "male" },
          { id: "Mia", name: "Mia", description: "Bright and friendly", gender: "female" },
          { id: "Liam", name: "Liam", description: "Deep narrator", gender: "male" },
          { id: "Emma", name: "Emma", description: "Soft and gentle", gender: "female" },
          { id: "Oliver", name: "Oliver", description: "British accent", gender: "male" },
          { id: "Sophia", name: "Sophia", description: "Warm storyteller", gender: "female" },
        ],
      },
    })
  );
  await page.route("**/voice/select", (r) => r.fulfill({ json: { voice_id: "Ashley", voice_source: "preset" } }));
  await page.route("**/api/execute_lips", async (r) => {
    await new Promise((res) => setTimeout(res, 300));
    r.fulfill({
      json: {
        status: "ok",
        error: null,
        response: "I would like some water.",
        steps: [
          { module: "vsr", prompt: { input: "<video clip>" }, response: { raw_transcription: "I WOULD LIKE SOME WHAT ER" } },
          { module: "correct", prompt: {}, response: { corrected: "I would like some water." } },
        ],
      },
    });
  });
  await page.route("**/speak", (r) =>
    r.fulfill({
      json: {
        audio: SILENT_MP3,
        mime: "audio/mpeg",
        tokens: [
          { t: "I ", start: 0 },
          { t: "would ", start: 0.1 },
          { t: "like ", start: 0.2 },
          { t: "some ", start: 0.3 },
          { t: "water.", start: 0.4 },
        ],
      },
    })
  );
  await page.route("**/api/runs", (r) => r.fulfill({ json: { id: 1 } }));
  await page.route("**/api/support", (r) => r.fulfill({ json: { id: 1 } }));
  await page.route("**/api/me/settings", (r) => r.fulfill({ json: { voice_id: "Ashley" } }));
  if (opts.admin) {
    await page.route("**/api/admin/overview", (r) =>
      r.fulfill({ json: { users: 12, settings_rows: 7, support_open: 2, runs_24h: 31, api_ok: true, vsr_ok: true, db_ok: true } })
    );
    await page.route("**/api/admin/users", (r) =>
      r.fulfill({
        json: {
          users: [
            { id: "user_1", email: "adam@example.com", name: "Adam Sion", role: "admin", created_at: "2026-09-01T10:00:00Z", last_sign_in_at: "2026-09-16T08:00:00Z", voice_id: "Brian" },
            { id: "user_2", email: "nurse@example.com", name: "Dana Levi", role: null, created_at: "2026-09-10T10:00:00Z", last_sign_in_at: null, voice_id: null },
          ],
        },
      })
    );
    await page.route("**/api/admin/settings", (r) => r.fulfill({ json: { settings: { default_voice_id: "Brian", lip_reading_enabled: true } } }));
    await page.route("**/api/admin/support", (r) =>
      r.fulfill({
        json: {
          messages: [
            { id: 1, user_id: "user_2", email: "nurse@example.com", message: "The Speak button is great. Could it also read slower?", status: "open", created_at: "2026-09-15T12:00:00Z" },
            { id: 2, user_id: null, email: null, message: "Works well on my phone.", status: "closed", created_at: "2026-09-14T12:00:00Z" },
          ],
        },
      })
    );
    await page.route("**/api/admin/audit**", (r) =>
      r.fulfill({ json: { entries: [{ id: 1, actor: "adam@example.com", action: "settings.patch", detail: { lip_reading_enabled: true }, created_at: "2026-09-16T09:00:00Z" }] } })
    );
    await page.route("**/api/admin/runs**", (r) =>
      r.fulfill({ json: { runs: [{ id: 1, user_id: "user_2", raw: "I WOULD LIKE SOME WHAT ER", corrected: "I would like some water.", latency_ms: 2140, created_at: "2026-09-16T09:30:00Z" }] } })
    );
    await page.route("**/api/team_info", (r) =>
      r.fulfill({ json: { team_name: "Chaplin AI", students: [{ name: "Adam Sion", email: "adamsion74@gmail.com" }, { name: "Jonathan Eshel", email: "jonathan.eshel1@gmail.com" }] } })
    );
    await page.route("**/api/agent_info", (r) =>
      r.fulfill({ json: { description: "Lip-reading communication agent.", purpose: "Turn noisy transcriptions into sentences.", prompt_template: { template: "POST /api/execute_lips with a clip." }, prompt_examples: [] } })
    );
  }
}
