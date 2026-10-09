import {describe, expect, test} from 'bun:test';

import {createRateGate} from '../../shared/core/rate-gate.js';

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {promise, resolve};
}

describe('rate gate', () => {
    test('starts open', () => {
        const gate = createRateGate({nowMs: () => 0});
        expect(gate.isOpen()).toBe(true);
    });

    test('serializes run() calls so a second never starts before the first settles', async () => {
        const gate = createRateGate({nowMs: () => 0});
        const first = deferred();
        let secondStarted = false;
        const order = [];

        const runningFirst = gate.run(async () => {
            order.push('first-start');
            await first.promise;
            order.push('first-end');
            return {ok: true};
        });

        const runningSecond = gate.run(async () => {
            secondStarted = true;
            order.push('second-start');
            return {ok: true};
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(secondStarted).toBe(false);

        first.resolve();
        await runningFirst;
        await runningSecond;

        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });

    test('closes until Retry-After elapses when a rate_limited result carries retryAfterMs', () => {
        let now = 1_000;
        const gate = createRateGate({nowMs: () => now});

        gate.recordResult({ok: false, error: {code: 'rate_limited', retryAfterMs: 5_000}});

        now = 5_999;
        expect(gate.isOpen()).toBe(false);

        now = 6_000;
        expect(gate.isOpen()).toBe(true);
    });

    test('falls back to the default exponential backoff when rate_limited has no retryAfterMs', () => {
        let now = 0;
        const gate = createRateGate({nowMs: () => now, initialDelayMs: 100, maxDelayMs: 1000});

        gate.recordResult({ok: false, error: {code: 'rate_limited'}});
        expect(gate.isOpen()).toBe(false);
        now = 99;
        expect(gate.isOpen()).toBe(false);
        now = 100;
        expect(gate.isOpen()).toBe(true);

        // Second consecutive rate_limited-without-header doubles the delay.
        gate.recordResult({ok: false, error: {code: 'rate_limited'}});
        now = 100 + 199;
        expect(gate.isOpen()).toBe(false);
        now = 100 + 200;
        expect(gate.isOpen()).toBe(true);
    });

    test('a success resets the escalation counter but does not cut a pending cooldown short', () => {
        let now = 0;
        const gate = createRateGate({nowMs: () => now, initialDelayMs: 100, maxDelayMs: 1000});

        gate.recordResult({ok: false, error: {code: 'rate_limited'}});
        expect(gate.isOpen()).toBe(false);

        // A sibling's success while the gate is still closed (e.g. the other
        // Claude account's call lands moments later) must not reopen it early.
        gate.recordResult({ok: true, data: {}});
        expect(gate.isOpen()).toBe(false);

        now = 100;
        expect(gate.isOpen()).toBe(true);

        // The success reset the escalation counter, so the next header-less
        // 429 closes for the base delay again, not a doubled one.
        gate.recordResult({ok: false, error: {code: 'rate_limited'}});
        now = 199;
        expect(gate.isOpen()).toBe(false);
        now = 200;
        expect(gate.isOpen()).toBe(true);
    });

    test('does not close the gate for non-rate_limited failures', () => {
        const gate = createRateGate({nowMs: () => 0});

        gate.recordResult({ok: false, error: {code: 'auth_expired'}});
        expect(gate.isOpen()).toBe(true);

        gate.recordResult({ok: false, error: {code: 'network_error'}});
        expect(gate.isOpen()).toBe(true);
    });

    test('abandon() releases the queue so a new run() proceeds although the previous fn never settled', async () => {
        const gate = createRateGate({nowMs: () => 0});
        let secondRan = false;

        void gate.run(() => new Promise(() => {})); // never settles; intentionally not awaited

        gate.abandon();

        await gate.run(async () => {
            secondRan = true;
            return {ok: true};
        });

        expect(secondRan).toBe(true);
    });
});
