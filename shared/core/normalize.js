function clampPercent(value) {
    if (!Number.isFinite(value))
        return 0;

    if (value < 0)
        return 0;

    if (value > 100)
        return 100;

    return value;
}

function unixSecondsToIso(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds))
        return null;

    return new Date(seconds * 1000).toISOString();
}

export function normalizeClaudeUsage(payload) {
    const fiveHourUtilization = Number(payload?.five_hour?.utilization);
    const sevenDayUtilization = Number(payload?.seven_day?.utilization);

    return {
        data: {
            sessionRemainingPct: clampPercent(100 - fiveHourUtilization),
            weeklyRemainingPct: clampPercent(100 - sevenDayUtilization),
            sessionResetsAtIso: payload?.five_hour?.resets_at ?? null,
            weeklyResetsAtIso: payload?.seven_day?.resets_at ?? null,
        },
        hasSessionUsage: Number.isFinite(fiveHourUtilization),
        hasWeeklyUsage: Number.isFinite(sevenDayUtilization),
    };
}

const DAY_SECONDS = 86_400;

// The usage API does not guarantee window positions: payloads have been seen
// with the 7-day window as primary_window and secondary_window set to null.
// Classify each window by its duration instead of trusting its position.
function classifyCodexWindows(rateLimit) {
    const primary = rateLimit?.primary_window ?? null;
    const secondary = rateLimit?.secondary_window ?? null;

    let sessionWindow = null;
    let weeklyWindow = null;

    for (const window of [primary, secondary]) {
        if (!window || typeof window !== 'object')
            continue;

        const seconds = Number(window.limit_window_seconds);
        if (!Number.isFinite(seconds))
            continue;

        if (seconds >= DAY_SECONDS)
            weeklyWindow ??= window;
        else
            sessionWindow ??= window;
    }

    // Legacy payloads without limit_window_seconds: fall back to positions.
    if (!sessionWindow && !weeklyWindow) {
        sessionWindow = primary;
        weeklyWindow = secondary;
    }

    return {sessionWindow, weeklyWindow};
}

export function normalizeCodexUsage(payload) {
    const {sessionWindow, weeklyWindow} = classifyCodexWindows(payload?.rate_limit);

    return {
        data: {
            sessionRemainingPct: sessionWindow
                ? clampPercent(100 - Number(sessionWindow.used_percent))
                : null,
            weeklyRemainingPct: weeklyWindow
                ? clampPercent(100 - Number(weeklyWindow.used_percent))
                : null,
            sessionResetsAtIso: unixSecondsToIso(sessionWindow?.reset_at),
            weeklyResetsAtIso: unixSecondsToIso(weeklyWindow?.reset_at),
        },
        hasPrimaryWindow: Boolean(sessionWindow),
        hasSecondaryWindow: Boolean(weeklyWindow),
        hasPartialData: !sessionWindow || !weeklyWindow,
    };
}
