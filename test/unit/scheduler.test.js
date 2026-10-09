import {describe, expect, test} from 'bun:test';

import {createBackoffManager} from '../../shared/core/backoff.js';
import {createRateGate} from '../../shared/core/rate-gate.js';
import {createScheduler, DEFAULT_POLL_INTERVAL_MS} from '../../shared/core/scheduler.js';

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function deferred() {
    let resolve;
    let reject;

    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });

    return {promise, resolve, reject};
}

describe('scheduler', () => {
    test('defaults to a 10 minute poll interval', () => {
        expect(DEFAULT_POLL_INTERVAL_MS).toBe(600_000);
    });

    test('polls all providers once per poll interval', async () => {
        let claudeCalls = 0;
        let codexCalls = 0;
        let intervalMs = null;
        let tick = null;

        const scheduler = createScheduler({
            setIntervalFn: (callback, ms) => {
                tick = callback;
                intervalMs = ms;
                return 1;
            },
            clearIntervalFn: () => {},
            providers: {
                claude: {
                    async getUsage() {
                        claudeCalls += 1;
                        return {ok: true, data: {sessionRemainingPct: 80, weeklyRemainingPct: 70}};
                    },
                },
                codex: {
                    async getUsage() {
                        codexCalls += 1;
                        return {ok: true, data: {sessionRemainingPct: 60, weeklyRemainingPct: 50}};
                    },
                },
            },
        });

        scheduler.start();
        await flushMicrotasks();

        expect(intervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
        expect(claudeCalls).toBe(1);
        expect(codexCalls).toBe(1);

        tick();
        await flushMicrotasks();

        expect(claudeCalls).toBe(2);
        expect(codexCalls).toBe(2);
        scheduler.stop();
    });

    test('keeps one in-flight request per provider and applies newest result', async () => {
        const first = deferred();
        let calls = 0;
        let active = 0;
        let peakActive = 0;

        const scheduler = createScheduler({
            providers: {
                claude: {
                    async getUsage() {
                        calls += 1;
                        active += 1;
                        peakActive = Math.max(peakActive, active);

                        if (calls === 1)
                            return first.promise.finally(() => {
                                active -= 1;
                            });

                        active -= 1;
                        return {
                            ok: true,
                            data: {
                                sessionRemainingPct: 88,
                                weeklyRemainingPct: 77,
                            },
                        };
                    },
                },
            },
        });

        const initialRefresh = scheduler.refresh();
        await flushMicrotasks();

        const queuedRefresh = scheduler.refresh();
        await flushMicrotasks();
        expect(calls).toBe(1);

        first.resolve({
            ok: true,
            data: {
                sessionRemainingPct: 20,
                weeklyRemainingPct: 10,
            },
        });

        await initialRefresh;
        await queuedRefresh;

        const summary = scheduler.getSummary();
        expect(calls).toBe(2);
        expect(peakActive).toBe(1);
        expect(summary.providers.claude.data).toEqual({
            sessionRemainingPct: 88,
            weeklyRemainingPct: 77,
        });
    });

    test('maps provider errors to unified state codes and computes summary fields', async () => {
        const scheduler = createScheduler({
            nowIso: () => '2026-02-08T12:00:00.000Z',
            providers: {
                claude: {
                    async getUsage() {
                        return {
                            ok: false,
                            error: {
                                code: 'auth_expired',
                                message: 'token expired',
                            },
                        };
                    },
                },
                codex: {
                    async getUsage() {
                        return {
                            ok: false,
                            error: {
                                code: 'partial_data',
                                message: 'missing weekly window',
                            },
                            data: {
                                sessionRemainingPct: 42,
                                weeklyRemainingPct: 0,
                            },
                        };
                    },
                },
            },
        });

        await scheduler.refresh();
        const summary = scheduler.getSummary();

        expect(summary.providers.claude.code).toBe('AUTH_EXPIRED');
        expect(summary.providers.codex.code).toBe('PARTIAL_DATA');
        expect(summary.providers.codex.error.providerCode).toBe('partial_data');
        expect(summary.minRemainingPct).toBe(0);
        expect(summary.lastUpdatedAtIso).toBe('2026-02-08T12:00:00.000Z');
    });

    test('skips polling while provider is in backoff window', async () => {
        let nowMs = 0;
        let calls = 0;

        const scheduler = createScheduler({
            backoffManager: createBackoffManager({
                initialDelayMs: 100,
                maxDelayMs: 500,
                nowMs: () => nowMs,
            }),
            providers: {
                codex: {
                    async getUsage() {
                        calls += 1;

                        if (calls === 1) {
                            return {
                                ok: false,
                                error: {
                                    code: 'rate_limited',
                                    message: 'slow down',
                                },
                            };
                        }

                        return {
                            ok: true,
                            data: {
                                sessionRemainingPct: 90,
                                weeklyRemainingPct: 80,
                            },
                        };
                    },
                },
            },
        });

        await scheduler.refresh();
        expect(calls).toBe(1);

        await scheduler.refresh();
        expect(calls).toBe(1);

        nowMs = 99;
        await scheduler.refresh();
        expect(calls).toBe(1);

        nowMs = 100;
        await scheduler.refresh();
        expect(calls).toBe(2);
    });

    test('invokes an injected keepalive controller after each provider result and exposes its status on the summary', async () => {
        const calls = [];
        const keepalive = {
            onProviderResult(name, result) {
                calls.push({name, result});
            },
            getStatus() {
                return {lastAttemptAt: 123, lastExitCode: 1, lastError: 'boom'};
            },
        };

        const scheduler = createScheduler({
            keepalive,
            providers: {
                claude: {
                    async getUsage() {
                        return {
                            ok: true,
                            data: {sessionRemainingPct: 90, weeklyRemainingPct: 80, sessionResetsAtIso: null},
                        };
                    },
                },
                codex: {
                    async getUsage() {
                        return {ok: true, data: {sessionRemainingPct: 70, weeklyRemainingPct: 60}};
                    },
                },
            },
        });

        await scheduler.refresh();

        expect(calls).toHaveLength(2);
        const claudeCall = calls.find((call) => call.name === 'claude');
        expect(claudeCall.result.code).toBe('OK');
        expect(claudeCall.result.data).toEqual({
            sessionRemainingPct: 90,
            weeklyRemainingPct: 80,
            sessionResetsAtIso: null,
        });

        const summary = scheduler.getSummary();
        expect(summary.keepalive).toEqual({lastAttemptAt: 123, lastExitCode: 1, lastError: 'boom'});
    });

    test('does not expose a keepalive summary field when no controller is injected', async () => {
        const scheduler = createScheduler({
            providers: {
                claude: {
                    async getUsage() {
                        return {ok: true, data: {sessionRemainingPct: 90, weeklyRemainingPct: 80}};
                    },
                },
            },
        });

        await scheduler.refresh();
        const summary = scheduler.getSummary();
        expect(summary.keepalive).toBeUndefined();
    });

    test('never runs two rate-gated providers concurrently, even in the same refresh', async () => {
        const first = deferred();
        let active = 0;
        let peakActive = 0;
        const calls = {claude: 0, claude2: 0};
        const gate = createRateGate({nowMs: () => 0});

        const scheduler = createScheduler({
            rateGates: {claude: gate, claude2: gate},
            providers: {
                claude: {
                    async getUsage() {
                        calls.claude += 1;
                        active += 1;
                        peakActive = Math.max(peakActive, active);
                        await first.promise;
                        active -= 1;
                        return {ok: true, data: {sessionRemainingPct: 90, weeklyRemainingPct: 80}};
                    },
                },
                claude2: {
                    async getUsage() {
                        calls.claude2 += 1;
                        active += 1;
                        peakActive = Math.max(peakActive, active);
                        active -= 1;
                        return {ok: true, data: {sessionRemainingPct: 50, weeklyRemainingPct: 40}};
                    },
                },
            },
        });

        const refreshing = scheduler.refresh();
        await flushMicrotasks();

        // claude is still awaiting `first`; claude2 must not have run yet.
        expect(calls.claude2).toBe(0);

        first.resolve();
        await refreshing;

        expect(calls.claude).toBe(1);
        expect(calls.claude2).toBe(1);
        expect(peakActive).toBe(1);
    });

    test('a 429 on one rate-gated account blocks both until the shared gate reopens', async () => {
        let nowMs = 0;
        const gate = createRateGate({nowMs: () => nowMs});
        const calls = {claude: 0, claude2: 0};

        const scheduler = createScheduler({
            nowMs: () => nowMs,
            rateGates: {claude: gate, claude2: gate},
            providers: {
                claude: {
                    async getUsage() {
                        calls.claude += 1;
                        if (calls.claude === 1) {
                            return {
                                ok: false,
                                error: {code: 'rate_limited', message: 'slow down', retryAfterMs: 5_000},
                            };
                        }
                        return {ok: true, data: {sessionRemainingPct: 90, weeklyRemainingPct: 80}};
                    },
                },
                claude2: {
                    async getUsage() {
                        calls.claude2 += 1;
                        return {ok: true, data: {sessionRemainingPct: 50, weeklyRemainingPct: 40}};
                    },
                },
            },
        });

        await scheduler.refresh();
        expect(calls.claude).toBe(1);
        expect(calls.claude2).toBe(1);

        // Gate is now closed for 5s from claude's 429. A refresh before it
        // reopens must not call either account again.
        nowMs = 4_999;
        await scheduler.refresh();
        expect(calls.claude).toBe(1);
        expect(calls.claude2).toBe(1);

        nowMs = 5_000;
        await scheduler.refresh();
        expect(calls.claude).toBe(2);
        expect(calls.claude2).toBe(2);
    });

    test('a rate-gated Claude 429 does not block an un-gated Codex provider', async () => {
        let nowMs = 0;
        const gate = createRateGate({nowMs: () => nowMs});
        let codexCalls = 0;

        const scheduler = createScheduler({
            nowMs: () => nowMs,
            rateGates: {claude: gate},
            providers: {
                claude: {
                    async getUsage() {
                        return {
                            ok: false,
                            error: {code: 'rate_limited', message: 'slow down', retryAfterMs: 60_000},
                        };
                    },
                },
                codex: {
                    async getUsage() {
                        codexCalls += 1;
                        return {ok: true, data: {sessionRemainingPct: 70, weeklyRemainingPct: 60}};
                    },
                },
            },
        });

        await scheduler.refresh();
        expect(codexCalls).toBe(1);

        // claude's gate is closed for 60s; codex has no gate and must still
        // be called on the very next refresh.
        await scheduler.refresh();
        expect(codexCalls).toBe(2);
    });

    test('a throwing keepalive controller does not break the poll loop', async () => {
        const scheduler = createScheduler({
            keepalive: {
                onProviderResult() {
                    throw new Error('keepalive exploded');
                },
            },
            providers: {
                claude: {
                    async getUsage() {
                        return {ok: true, data: {sessionRemainingPct: 90, weeklyRemainingPct: 80}};
                    },
                },
            },
        });

        const summary = await scheduler.refresh();
        expect(summary).toBeDefined();
        expect(summary.providers.claude.code).toBe('OK');
    });
});
