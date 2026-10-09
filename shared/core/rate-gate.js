import {DEFAULT_BACKOFF_INITIAL_DELAY_MS, DEFAULT_BACKOFF_MAX_DELAY_MS} from './backoff.js';

function computeFallbackDelayMs(initialDelayMs, maxDelayMs, attempt) {
    const cappedAttempt = Math.max(1, attempt);
    const delay = initialDelayMs * (2 ** (cappedAttempt - 1));
    return Math.min(delay, maxDelayMs);
}

// A shared gate for several provider instances that hit the same
// rate-limited upstream (e.g. two Claude accounts against the same
// api.anthropic.com edge limit). Two things it guarantees across every
// caller that shares one instance:
//   - run(): never runs two callers' work concurrently (a serial queue, like
//     a per-provider state.queue in scheduler.js, but shared across names).
//   - recordResult(): a 429 (rate_limited) closes the gate for every caller
//     until the server's own Retry-After elapses, or the existing
//     exponential backoff schedule when the header was absent — instead of
//     each caller keeping its own independent cooldown clock.
export function createRateGate(options = {}) {
    const nowMs = options.nowMs ?? (() => Date.now());
    const initialDelayMs = options.initialDelayMs ?? DEFAULT_BACKOFF_INITIAL_DELAY_MS;
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_BACKOFF_MAX_DELAY_MS;

    let openAtMs = 0;
    let attempt = 0;
    let queue = Promise.resolve();

    function isOpen() {
        return nowMs() >= openAtMs;
    }

    function recordResult(result) {
        if (result?.ok) {
            // Reset the escalation counter so the next header-less 429 starts
            // from the base delay again. Deliberately does NOT clear openAtMs:
            // with two callers sharing one gate, a sibling's success must not
            // cut short a cooldown another caller's 429 just established —
            // isOpen() reopens on its own once real time passes it.
            attempt = 0;
            return;
        }

        if (result?.error?.code !== 'rate_limited')
            return;

        const retryAfterMs = result?.error?.retryAfterMs;

        if (Number.isFinite(retryAfterMs)) {
            attempt = 0;
            openAtMs = Math.max(openAtMs, nowMs() + Math.max(0, retryAfterMs));
            return;
        }

        attempt += 1;
        const delayMs = computeFallbackDelayMs(initialDelayMs, maxDelayMs, attempt);
        openAtMs = Math.max(openAtMs, nowMs() + delayMs);
    }

    // Queues fn behind every previously queued caller. The queue tracks
    // "the previous slot is free" (it always resolves, never rejects), not
    // the previous caller's value, so one caller's rejection never blocks or
    // poisons the next caller's turn.
    function run(fn) {
        const scheduled = queue.then(fn);
        queue = scheduled.then(() => undefined, () => undefined);
        return scheduled;
    }

    return {
        isOpen,
        getOpenAtMs: () => openAtMs,
        recordResult,
        run,
    };
}
