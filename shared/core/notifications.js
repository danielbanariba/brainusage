const DEFAULT_THRESHOLD_PCT = 20;

// Default provider/label pairs for the single-account setup. app.mjs passes
// a custom list (adding the second Claude account under its own key/label)
// only when a second account is configured, keeping this default unchanged.
const DEFAULT_PROVIDERS = [
    {key: 'claude', label: 'Claude'},
    {key: 'codex', label: 'Codex'},
];

const WINDOWS = [
    {
        key: 'session',
        remainingKey: 'sessionRemainingPct',
        resetKey: 'sessionResetsAtIso',
    },
    {
        key: 'weekly',
        remainingKey: 'weeklyRemainingPct',
        resetKey: 'weeklyResetsAtIso',
    },
];

function formatIsoMinuteUtc(iso) {
    if (!iso)
        return '--';

    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '--';

    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function createWindowState(resetPeriod) {
    return {
        previousRemainingPct: null,
        resetPeriod,
        hasNotifiedBelowThreshold: false,
    };
}

export function createThresholdNotifier(options = {}) {
    const thresholdPct = options.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
    const notifyFn = typeof options.notifyFn === 'function'
        ? options.notifyFn
        : () => {};
    const providers = Array.isArray(options.providers) && options.providers.length > 0
        ? options.providers
        : DEFAULT_PROVIDERS;
    const state = new Map();

    function evaluate(summary) {
        for (const provider of providers) {
            const providerData = summary?.providers?.[provider.key]?.data;
            if (!providerData)
                continue;

            for (const windowDef of WINDOWS) {
                const remainingPct = providerData[windowDef.remainingKey];
                if (!Number.isFinite(remainingPct))
                    continue;

                const resetsAtIso = typeof providerData[windowDef.resetKey] === 'string' && providerData[windowDef.resetKey].length > 0
                    ? providerData[windowDef.resetKey]
                    : null;
                const windowStateKey = `${provider.key}:${windowDef.key}`;
                const windowState = state.get(windowStateKey) ?? createWindowState(resetsAtIso);

                if (windowState.resetPeriod !== resetsAtIso) {
                    windowState.resetPeriod = resetsAtIso;
                    windowState.hasNotifiedBelowThreshold = false;
                }

                const crossedThreshold = Number.isFinite(windowState.previousRemainingPct)
                    && windowState.previousRemainingPct >= thresholdPct
                    && remainingPct < thresholdPct;

                if (crossedThreshold && !windowState.hasNotifiedBelowThreshold) {
                    const title = `${provider.label} ${windowDef.key} low`;
                    const body = `${Math.round(remainingPct)}% remaining; resets ${formatIsoMinuteUtc(resetsAtIso)}`;

                    notifyFn(title, body);
                    windowState.hasNotifiedBelowThreshold = true;
                }

                if (remainingPct >= thresholdPct)
                    windowState.hasNotifiedBelowThreshold = false;

                windowState.previousRemainingPct = remainingPct;
                state.set(windowStateKey, windowState);
            }
        }
    }

    return {
        evaluate,
    };
}
