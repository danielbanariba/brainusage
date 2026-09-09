import {describe, expect, test} from 'bun:test';

import {
    CLAUDE_PROVIDER_NAME,
    DEFAULT_KEEPALIVE_COOLDOWN_MS,
    DEFAULT_KEEPALIVE_GRACE_MS,
    KEEPALIVE_EXTRA_PATH_ENTRIES,
    KEEPALIVE_TIMEOUT_SECONDS,
    buildShellCommand,
    createKeepalive,
    shouldKeepalive,
} from '../../shared/core/keepalive.js';

function deferred() {
    let resolve;
    let reject;

    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });

    return {promise, resolve, reject};
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('buildShellCommand', () => {
    test('wraps the user command with the PATH prefix and timeout', () => {
        expect(buildShellCommand('claude -p ok')).toBe(
            'export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"; timeout 120 claude -p ok',
        );
    });

    test('reuses the exported constants rather than duplicating them', () => {
        expect(KEEPALIVE_TIMEOUT_SECONDS).toBe(120);
        expect(KEEPALIVE_EXTRA_PATH_ENTRIES).toEqual(['$HOME/.local/bin', '$HOME/.claude/local']);
        expect(buildShellCommand('echo hi')).toBe(
            `export PATH="${KEEPALIVE_EXTRA_PATH_ENTRIES.join(':')}:$PATH"; timeout ${KEEPALIVE_TIMEOUT_SECONDS} echo hi`,
        );
    });

    test('preserves a command containing its own quoted arguments', () => {
        const userCommand = 'claude -p ok --system-prompt "Reply with the single word: ok"';
        expect(buildShellCommand(userCommand)).toBe(
            `export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"; timeout 120 ${userCommand}`,
        );
    });
});

describe('shouldKeepalive', () => {
    const NOW = Date.parse('2026-02-09T10:00:00.000Z');

    function baseOptions(overrides = {}) {
        return {
            enabled: true,
            status: 'OK',
            sessionResetsAtIso: null,
            weeklyRemainingPct: 50,
            now: NOW,
            lastAttemptAt: null,
            ...overrides,
        };
    }

    test('is false when disabled', () => {
        expect(shouldKeepalive(baseOptions({enabled: false}))).toBe(false);
    });

    test('is true when enabled, fresh OK status, and no active session window', () => {
        expect(shouldKeepalive(baseOptions())).toBe(true);
    });

    test('is true for PARTIAL_DATA status', () => {
        expect(shouldKeepalive(baseOptions({status: 'PARTIAL_DATA'}))).toBe(true);
    });

    for (const staleStatus of ['RATE_LIMITED', 'NETWORK_ERROR', 'AUTH_EXPIRED', 'SCHEMA_CHANGED', null, undefined]) {
        test(`is false for non-fresh status ${String(staleStatus)}`, () => {
            expect(shouldKeepalive(baseOptions({status: staleStatus}))).toBe(false);
        });
    }

    test('is false when sessionResetsAtIso is in the future (active window)', () => {
        const future = new Date(NOW + 60 * 60_000).toISOString();
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: future}))).toBe(false);
    });

    test('is true when sessionResetsAtIso is an empty string', () => {
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: ''}))).toBe(true);
    });

    test('is true when sessionResetsAtIso fails to parse', () => {
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: 'not-a-date'}))).toBe(true);
    });

    test('is false when sessionResetsAtIso is still within the grace period', () => {
        const withinGrace = new Date(NOW - (DEFAULT_KEEPALIVE_GRACE_MS - 1000)).toISOString();
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: withinGrace}))).toBe(false);
    });

    test('is true when sessionResetsAtIso is exactly at the grace boundary', () => {
        const atBoundary = new Date(NOW - DEFAULT_KEEPALIVE_GRACE_MS).toISOString();
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: atBoundary}))).toBe(true);
    });

    test('is true when sessionResetsAtIso is well past the grace period', () => {
        const longExpired = new Date(NOW - DEFAULT_KEEPALIVE_GRACE_MS - 60_000).toISOString();
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: longExpired}))).toBe(true);
    });

    test('respects a custom graceMs', () => {
        const tenSecondsAgo = new Date(NOW - 10_000).toISOString();
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: tenSecondsAgo, graceMs: 5_000}))).toBe(true);
        expect(shouldKeepalive(baseOptions({sessionResetsAtIso: tenSecondsAgo, graceMs: 20_000}))).toBe(false);
    });

    test('is false when the weekly window is exhausted', () => {
        expect(shouldKeepalive(baseOptions({weeklyRemainingPct: 0}))).toBe(false);
        expect(shouldKeepalive(baseOptions({weeklyRemainingPct: -5}))).toBe(false);
    });

    test('is true when weeklyRemainingPct is absent from normalized data', () => {
        expect(shouldKeepalive(baseOptions({weeklyRemainingPct: undefined}))).toBe(true);
    });

    test('is true when the weekly window still has remaining quota', () => {
        expect(shouldKeepalive(baseOptions({weeklyRemainingPct: 1}))).toBe(true);
    });

    test('is false while inside the cooldown window', () => {
        const lastAttemptAt = NOW - (DEFAULT_KEEPALIVE_COOLDOWN_MS - 1);
        expect(shouldKeepalive(baseOptions({lastAttemptAt}))).toBe(false);
    });

    test('is true exactly at the cooldown boundary', () => {
        const lastAttemptAt = NOW - DEFAULT_KEEPALIVE_COOLDOWN_MS;
        expect(shouldKeepalive(baseOptions({lastAttemptAt}))).toBe(true);
    });

    test('is true when lastAttemptAt is null (never attempted)', () => {
        expect(shouldKeepalive(baseOptions({lastAttemptAt: null}))).toBe(true);
    });

    test('respects a custom cooldownMs', () => {
        const lastAttemptAt = NOW - 5_000;
        expect(shouldKeepalive(baseOptions({lastAttemptAt, cooldownMs: 10_000}))).toBe(false);
        expect(shouldKeepalive(baseOptions({lastAttemptAt, cooldownMs: 1_000}))).toBe(true);
    });
});

describe('createKeepalive', () => {
    function makeController(overrides = {}) {
        let nowMs = Date.parse('2026-02-09T10:00:00.000Z');

        const controller = createKeepalive({
            isEnabled: () => true,
            getCommand: () => 'claude -p ok',
            now: () => nowMs,
            ...overrides,
        });

        return {
            controller,
            advanceTime(ms) { nowMs += ms; },
        };
    }

    test('only acts on the claude provider', async () => {
        let calls = 0;
        const {controller} = makeController({
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult('codex', {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(calls).toBe(0);
        expect(controller.getStatus()).toEqual({lastAttemptAt: null, lastExitCode: null, lastError: null});
    });

    test('does nothing when disabled', async () => {
        let calls = 0;
        const {controller} = makeController({
            isEnabled: () => false,
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(calls).toBe(0);
    });

    test('runs the wrapped command for an eligible claude result', async () => {
        let receivedCommand = null;
        const {controller} = makeController({
            getCommand: () => 'claude -p ok',
            runCommand: async (cmd) => { receivedCommand = cmd; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {
            code: 'OK',
            data: {sessionResetsAtIso: null, weeklyRemainingPct: 50},
        });
        await flushMicrotasks();

        expect(receivedCommand).toBe(
            'export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"; timeout 120 claude -p ok',
        );
    });

    test('triggers for PARTIAL_DATA results with no future session reset', async () => {
        let calls = 0;
        const {controller} = makeController({
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'PARTIAL_DATA', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(calls).toBe(1);
    });

    test('does not trigger while a session window is active', async () => {
        let calls = 0;
        const {controller} = makeController({
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {
            code: 'OK',
            data: {sessionResetsAtIso: '2026-02-09T14:00:00.000Z'},
        });
        await flushMicrotasks();

        expect(calls).toBe(0);
    });

    test('records the attempt time before the command resolves', async () => {
        const pending = deferred();
        const {controller} = makeController({
            runCommand: () => pending.promise,
        });

        expect(controller.getStatus().lastAttemptAt).toBe(null);

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(controller.getStatus().lastAttemptAt).not.toBe(null);
        expect(controller.getStatus().lastExitCode).toBe(null);

        pending.resolve({exitCode: 0, stderr: ''});
        await flushMicrotasks();

        expect(controller.getStatus().lastExitCode).toBe(0);
    });

    test('records a non-zero exit code and stderr as the last error', async () => {
        const {controller} = makeController({
            runCommand: async () => ({exitCode: 127, stderr: 'command not found'}),
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        const status = controller.getStatus();
        expect(status.lastExitCode).toBe(127);
        expect(status.lastError).toBe('command not found');
        expect(typeof status.lastAttemptAt).toBe('number');
    });

    test('logs a success message when the command exits cleanly', async () => {
        const logs = [];
        const {controller} = makeController({
            runCommand: async () => ({exitCode: 0, stderr: ''}),
            log: (message) => logs.push(message),
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(logs).toEqual(['keepalive: ping succeeded']);
    });

    test('logs the error when the command exits with a non-zero code', async () => {
        const logs = [];
        const {controller} = makeController({
            runCommand: async () => ({exitCode: 127, stderr: 'command not found'}),
            log: (message) => logs.push(message),
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(logs).toEqual(['keepalive: command not found']);
    });

    test('records a rejected runCommand as an error without throwing out of the caller', async () => {
        const {controller} = makeController({
            runCommand: async () => { throw new Error('spawn failed'); },
        });

        expect(() => controller.onProviderResult(CLAUDE_PROVIDER_NAME, {
            code: 'OK',
            data: {sessionResetsAtIso: null},
        })).not.toThrow();
        await flushMicrotasks();

        expect(controller.getStatus().lastExitCode).toBe(null);
        expect(controller.getStatus().lastError).toBe('spawn failed');
    });

    test('never throws synchronously even if a dependency throws', () => {
        const {controller} = makeController({
            getCommand: () => { throw new Error('boom'); },
        });

        expect(() => controller.onProviderResult(CLAUDE_PROVIDER_NAME, {
            code: 'OK',
            data: {sessionResetsAtIso: null},
        })).not.toThrow();
    });

    test('enforces the cooldown between attempts', async () => {
        let calls = 0;
        const {controller, advanceTime} = makeController({
            cooldownMs: 30 * 60_000,
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();
        expect(calls).toBe(1);

        advanceTime(10 * 60_000);
        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();
        expect(calls).toBe(1);

        advanceTime(20 * 60_000);
        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();
        expect(calls).toBe(2);
    });

    test('skips silently when no command is configured', async () => {
        let calls = 0;
        const {controller} = makeController({
            getCommand: () => '',
            runCommand: async () => { calls += 1; return {exitCode: 0, stderr: ''}; },
        });

        controller.onProviderResult(CLAUDE_PROVIDER_NAME, {code: 'OK', data: {sessionResetsAtIso: null}});
        await flushMicrotasks();

        expect(calls).toBe(0);
        expect(controller.getStatus().lastAttemptAt).toBe(null);
    });
});
