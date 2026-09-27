import { Script } from "node:vm";
import { observe, readState } from "./inspect.mjs";
import { failures } from "./core.mjs";

// Trusted local code, like --setup and cli run-code. No second action language or browser server.
export function batchSource(source, artifactBase) {
  const expression = source.trim().replace(/;$/, "");
  new Script(`(${expression})`); // Reject malformed input before browser interactions.
  return `async page => {
    const observe = ${observe.toString()};
    const readState = ${readState.toString()};
    const failures = ${failures.toString()};
    const started = Date.now();
    const steps = [];
    const artifacts = {};
    const artifactErrors = [];
    const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
    const step = async (name, action) => {
      const item = { name: String(name).slice(0, 120), ms: 0, ok: false };
      if (steps.length >= 100) throw new Error('A batch supports at most 100 named steps.');
      steps.push(item);
      const start = Date.now();
      try { const value = await action(); item.ok = true; return value; }
      finally { item.ms = Date.now() - start; }
    };
    let result = null, error = null;
    try {
      result = await (${expression})(page, {
        observe: (target, options) => observe(page, target, options),
        state: sections => readState(page, sections), step, assert,
      }) ?? null;
      // Require serializable results while still inside the evidence-capture boundary.
      JSON.stringify(result);
      const faults = failures(page.context().__chessUxFaults);
      if (faults.length) throw new Error(faults.length + ' retained browser fault(s): ' + faults.slice(-3).map(f => f.kind + ': ' + f.detail).join('; '));
    } catch (failure) {
      error = String(failure?.message ?? failure).slice(0, 2000);
      try {
        await page.screenshot({ path: ${JSON.stringify(`${artifactBase}.png`)}, timeout: 5000, scale: 'css' });
        artifacts.screenshot = ${JSON.stringify(`${artifactBase}.png`)};
      } catch (failure) { artifactErrors.push('screenshot: ' + String(failure.message).slice(0, 300)); }
      try { artifacts.state = await readState(page); }
      catch (failure) { artifactErrors.push('state: ' + String(failure.message).slice(0, 300)); }
    }
    return { ok: error === null, result: error === null ? result : null, error, steps,
      executionMs: Date.now() - started, artifacts, artifactErrors,
      faults: (page.context().__chessUxFaults ?? []).slice(-20),
      faultCount: page.context().__chessUxFaults?.length ?? null };
  }`;
}
