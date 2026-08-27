import {computeSummary} from './aggregate.js';
import {createBackoffManager} from './backoff.js';
import {applyProviderResult, createProviderState} from './state.js';

export const DEFAULT_POLL_INTERVAL_MS = 180_000;

// A provider request that never settles blocks that provider's queue forever.
// It cannot be given a deadline where it runs: Qt's QML XMLHttpRequest
// implements neither `timeout` nor `ontimeout`, and the QML JS engine has no
// setTimeout. The poll itself is the only clock available, so a request still
// in flight after this long is abandoned on the next attempt.
export const DEFAULT_STALLED_REQUEST_MS = 120_000;

function normalizeProviders(providersInput) {
    if (Array.isArray(providersInput)) {
        return providersInput.map((provider, index) => {
            const name = provider?.name ?? `provider_${index}`;
            return {name, provider};
        });
    }

    if (providersInput && typeof providersInput === 'object') {
        return Object.entries(providersInput).map(([name, provider]) => ({name, provider}));
    }

    return [];
}

function createNetworkFailureResult() {
    return {
        ok: false,
        error: {
            code: 'network_error',
            message: 'Provider request threw before returning a result',
        },
    };
}

export function createScheduler(options = {}) {
    const providers = normalizeProviders(options.providers);
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const nowIso = options.nowIso ?? (() => new Date().toISOString());
    const onUpdate = options.onUpdate ?? null;
    const nowMs = options.nowMs ?? (() => Date.now());
    const stalledRequestMs = options.stalledRequestMs ?? DEFAULT_STALLED_REQUEST_MS;
    const setIntervalFn = options.setIntervalFn ?? globalThis.setInterval;
    const clearIntervalFn = options.clearIntervalFn ?? globalThis.clearInterval;
    const backoffManager = options.backoffManager ?? createBackoffManager();
    const providerStates = new Map();

    for (const {name} of providers)
        providerStates.set(name, createProviderState(name));

    let timerId = null;

    function notify() {
        if (typeof onUpdate !== 'function')
            return;

        onUpdate(computeSummary(providerStates));
    }

    function queueProviderRequest(name, provider) {
        const state = providerStates.get(name);
        if (!state || !provider || typeof provider.getUsage !== 'function')
            return Promise.resolve();

        // Abandon a request that has hung: the queue is a promise chain, so
        // one that never settles stalls every later refresh. Dropping the
        // chain loses the dangling request, not the provider.
        if (state.inFlight
            && state.inFlightSinceMs !== null
            && nowMs() - state.inFlightSinceMs >= stalledRequestMs) {
            state.inFlight = false;
            state.inFlightSinceMs = null;
            state.queue = Promise.resolve();
        }

        if (backoffManager.shouldBackoff(name))
            return Promise.resolve();

        const requestId = state.latestRequestedRequestId + 1;
        state.latestRequestedRequestId = requestId;

        state.queue = state.queue.then(async () => {
            state.inFlight = true;
            state.inFlightSinceMs = nowMs();
            notify();

            let result;

            try {
                result = await provider.getUsage();
            } catch {
                result = createNetworkFailureResult();
            }

            applyProviderResult(state, result, requestId, nowIso());
            backoffManager.recordResult(name, result);

            // Only the newest request owns the flag: an abandoned one that
            // finally settles must not clear it out from under its successor.
            if (state.latestRequestedRequestId === requestId) {
                state.inFlight = false;
                state.inFlightSinceMs = null;
            }

            notify();
        });

        return state.queue;
    }

    async function refresh() {
        const runs = providers.map(({name, provider}) => queueProviderRequest(name, provider));
        await Promise.all(runs);
        return getSummary();
    }

    function start() {
        if (timerId)
            return;

        timerId = setIntervalFn(() => {
            void refresh();
        }, pollIntervalMs);

        void refresh();
    }

    function stop() {
        if (!timerId)
            return;

        clearIntervalFn(timerId);
        timerId = null;
    }

    function getSummary() {
        return computeSummary(providerStates);
    }

    return {
        start,
        stop,
        refresh,
        getSummary,
    };
}
