// Optional "session keepalive" feature for the Claude provider.
//
// Anthropic's subscription 5-hour session window opens at the user's first
// message and closes exactly 5 hours later. If no window is active, sending
// one tiny message opens the window now (e.g. at boot) instead of at the
// user's first real message, which would otherwise push the reset later.
// This never hurts: unused quota does not carry over. Opt-in, default off.

export const KEEPALIVE_TIMEOUT_SECONDS = 120;
export const KEEPALIVE_EXTRA_PATH_ENTRIES = ['$HOME/.local/bin', '$HOME/.claude/local'];
export const DEFAULT_KEEPALIVE_COOLDOWN_MS = 30 * 60_000;
export const DEFAULT_KEEPALIVE_GRACE_MS = 60_000;
export const CLAUDE_PROVIDER_NAME = 'claude';

// Poll result codes that carry fresh (not stale/retained) provider data.
// RATE_LIMITED/NETWORK_ERROR/AUTH_EXPIRED/SCHEMA_CHANGED never trigger a ping.
const FRESH_STATUS_CODES = new Set(['OK', 'PARTIAL_DATA']);

// Wraps a user-provided command so it runs from a plasmashell-style
// environment where the shell PATH (e.g. `$HOME/.local/bin`, where the
// native claude installer places the binary) is not on PATH, and bounds its
// runtime so a hung process cannot block the widget indefinitely.
export function buildShellCommand(userCommand) {
    const pathPrefix = `${KEEPALIVE_EXTRA_PATH_ENTRIES.join(':')}:$PATH`;
    return `export PATH="${pathPrefix}"; timeout ${KEEPALIVE_TIMEOUT_SECONDS} ${userCommand}`;
}

function hasActiveSessionWindow(sessionResetsAtIso, now, graceMs) {
    if (typeof sessionResetsAtIso !== 'string' || sessionResetsAtIso.length === 0)
        return false;

    const parsed = Date.parse(sessionResetsAtIso);
    if (Number.isNaN(parsed))
        return false;

    return parsed > now - graceMs;
}

function isWeeklyExhausted(weeklyRemainingPct) {
    return Number.isFinite(weeklyRemainingPct) && weeklyRemainingPct <= 0;
}

function isCoolingDown(lastAttemptAt, now, cooldownMs) {
    if (lastAttemptAt === null || lastAttemptAt === undefined)
        return false;

    return (now - lastAttemptAt) < cooldownMs;
}

// Decides whether to send a keepalive ping right now. True only when:
// enabled; the poll result is fresh (OK or PARTIAL_DATA, never retained/stale
// data); there is no active session window (sessionResetsAtIso is null/empty,
// unparsable, or expired at least graceMs ago); the weekly window still has
// quota left (when that field is present); and the cooldown has elapsed.
export function shouldKeepalive(options = {}) {
    const {
        enabled,
        status,
        sessionResetsAtIso,
        weeklyRemainingPct,
        now,
        lastAttemptAt,
        cooldownMs = DEFAULT_KEEPALIVE_COOLDOWN_MS,
        graceMs = DEFAULT_KEEPALIVE_GRACE_MS,
    } = options;

    if (!enabled)
        return false;

    if (!FRESH_STATUS_CODES.has(status))
        return false;

    if (hasActiveSessionWindow(sessionResetsAtIso, now, graceMs))
        return false;

    if (isWeeklyExhausted(weeklyRemainingPct))
        return false;

    if (isCoolingDown(lastAttemptAt, now, cooldownMs))
        return false;

    return true;
}

// Controller wired into the scheduler's poll loop. onProviderResult is called
// with the mapped state code and normalized data for a single provider after
// each poll; it only acts on the Claude provider and never throws.
export function createKeepalive(options = {}) {
    const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => false;
    const getCommand = typeof options.getCommand === 'function' ? options.getCommand : () => '';
    const runCommand = typeof options.runCommand === 'function' ? options.runCommand : null;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const log = typeof options.log === 'function' ? options.log : () => {};
    const cooldownMs = options.cooldownMs ?? DEFAULT_KEEPALIVE_COOLDOWN_MS;
    const graceMs = options.graceMs ?? DEFAULT_KEEPALIVE_GRACE_MS;

    let lastAttemptAt = null;
    let lastExitCode = null;
    let lastError = null;

    async function attempt(shellCommand, attemptAtMs) {
        // Record the attempt time before running so the cooldown holds even
        // if the runner hangs or never resolves.
        lastAttemptAt = attemptAtMs;

        if (!runCommand) {
            lastExitCode = null;
            lastError = 'runCommand dependency is missing';
            log(`keepalive: ${lastError}`);
            return;
        }

        try {
            const outcome = await runCommand(shellCommand);
            const exitCode = outcome?.exitCode;
            lastExitCode = Number.isFinite(exitCode) ? exitCode : null;
            lastError = lastExitCode === 0
                ? null
                : (outcome?.stderr || `command exited with code ${lastExitCode}`);
        } catch (error) {
            lastExitCode = null;
            lastError = error?.message ?? String(error);
            log(`keepalive: command failed: ${lastError}`);
        }
    }

    function onProviderResult(providerName, result) {
        try {
            if (providerName !== CLAUDE_PROVIDER_NAME)
                return;

            const data = result?.data ?? null;
            const nowMs = now();

            const eligible = shouldKeepalive({
                enabled: isEnabled(),
                status: result?.code ?? null,
                sessionResetsAtIso: data?.sessionResetsAtIso ?? null,
                weeklyRemainingPct: data?.weeklyRemainingPct,
                now: nowMs,
                lastAttemptAt,
                cooldownMs,
                graceMs,
            });

            if (!eligible)
                return;

            const userCommand = getCommand();
            if (!userCommand) {
                log('keepalive: no command configured, skipping');
                return;
            }

            attempt(buildShellCommand(userCommand), nowMs);
        } catch (error) {
            log(`keepalive: unexpected error: ${error?.message ?? error}`);
        }
    }

    function getStatus() {
        return {lastAttemptAt, lastExitCode, lastError};
    }

    return {onProviderResult, getStatus};
}
