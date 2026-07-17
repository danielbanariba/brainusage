import {describe, expect, test} from 'bun:test';

import {normalizeCodexUsage} from '../../shared/core/normalize.js';

describe('normalizeCodexUsage', () => {
    test('classifies windows by duration when the weekly window arrives as primary_window', () => {
        const normalized = normalizeCodexUsage({
            rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                    used_percent: 2,
                    limit_window_seconds: 604_800,
                    reset_after_seconds: 587_758,
                    reset_at: 1_784_850_454,
                },
                secondary_window: null,
            },
        });

        expect(normalized.data).toEqual({
            sessionRemainingPct: null,
            weeklyRemainingPct: 98,
            sessionResetsAtIso: null,
            weeklyResetsAtIso: '2026-07-23T23:47:34.000Z',
        });
        expect(normalized.hasPartialData).toBe(true);
    });

    test('keeps the classic mapping for both-windows payloads carrying durations', () => {
        const normalized = normalizeCodexUsage({
            rate_limit: {
                primary_window: {
                    used_percent: 18,
                    limit_window_seconds: 18_000,
                    reset_at: 1_770_508_800,
                },
                secondary_window: {
                    used_percent: 5,
                    limit_window_seconds: 604_800,
                    reset_at: 1_770_768_000,
                },
            },
        });

        expect(normalized.data).toEqual({
            sessionRemainingPct: 82,
            weeklyRemainingPct: 95,
            sessionResetsAtIso: '2026-02-08T00:00:00.000Z',
            weeklyResetsAtIso: '2026-02-11T00:00:00.000Z',
        });
        expect(normalized.hasPartialData).toBe(false);
    });

    test('falls back to positional mapping for legacy payloads without durations', () => {
        const normalized = normalizeCodexUsage({
            rate_limit: {
                primary_window: {used_percent: 42, reset_at: 1_770_508_800},
                secondary_window: {used_percent: 64, reset_at: 1_770_768_000},
            },
        });

        expect(normalized.data).toEqual({
            sessionRemainingPct: 58,
            weeklyRemainingPct: 36,
            sessionResetsAtIso: '2026-02-08T00:00:00.000Z',
            weeklyResetsAtIso: '2026-02-11T00:00:00.000Z',
        });
        expect(normalized.hasPartialData).toBe(false);
    });
});
