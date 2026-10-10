import { liveModels, probeBackend } from "./codex-backend";

// Playwright globalSetup: one small round trip per model before any browser starts, so a missing
// login, an unknown model or a backend that moved fails the run once with its classified message
// instead of failing every journey with app-level symptoms.
export default async function preflight() {
  for (const model of liveModels()) {
    const started = Date.now();
    const result = await probeBackend(model);
    console.log(
      `Codex backend ready: ${model} answered the probe in ${Date.now() - started}ms ` +
        `(${result.toolCalls.length ? "tool call" : "text only"}).`,
    );
  }
}
