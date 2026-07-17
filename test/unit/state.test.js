import {describe, expect, test} from 'bun:test';

import {applyProviderResult, createProviderState} from '../../shared/core/state.js';

describe('provider state', () => {
    test('keeps last known data when a failure result carries no data', () => {
        const state = createProviderState('claude');

        applyProviderResult(state, {
            ok: true,
            data: {sessionRemainingPct: 80, weeklyRemainingPct: 70},
        }, 1, '2026-02-08T00:00:00.000Z');

        applyProviderResult(state, {
            ok: false,
            error: {code: 'rate_limited', message: 'slow down'},
        }, 2, '2026-02-08T00:10:00.000Z');

        expect(state.code).toBe('RATE_LIMITED');
        expect(state.data).toEqual({sessionRemainingPct: 80, weeklyRemainingPct: 70});
        expect(state.error.providerCode).toBe('rate_limited');
    });

    test('prefers failure-carried data over the stale snapshot', () => {
        const state = createProviderState('codex');

        applyProviderResult(state, {
            ok: true,
            data: {sessionRemainingPct: 80, weeklyRemainingPct: 70},
        }, 1, '2026-02-08T00:00:00.000Z');

        applyProviderResult(state, {
            ok: false,
            error: {code: 'partial_data', message: 'missing weekly window'},
            data: {sessionRemainingPct: 42, weeklyRemainingPct: null},
        }, 2, '2026-02-08T00:10:00.000Z');

        expect(state.code).toBe('PARTIAL_DATA');
        expect(state.data).toEqual({sessionRemainingPct: 42, weeklyRemainingPct: null});
    });
});
