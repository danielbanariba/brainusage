import {normalizeClaudeUsage} from '../core/normalize.js';
import {encodeForm} from '../core/http.js';

const CREDENTIALS_PATH = '~/.claude/.credentials.json';
const REFRESH_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function defaultReadTextFile() {
    throw new Error('readTextFile dependency is required in this runtime');
}

function resolveCredentialsPath(homeDir, credentialsPath = CREDENTIALS_PATH) {
    if (homeDir && credentialsPath.startsWith('~/'))
        return `${homeDir}${credentialsPath.slice(1)}`;

    return credentialsPath;
}

function resolveAccessToken(credentials) {
    return credentials?.accessToken
        ?? credentials?.access_token
        ?? credentials?.token
        ?? null;
}

function resolveRefreshToken(credentials) {
    return credentials?.refreshToken
        ?? credentials?.refresh_token
        ?? null;
}

function resolveExpiry(credentials) {
    return credentials?.expiresAt
        ?? credentials?.expires_at
        ?? credentials?.expiry
        ?? null;
}

function isTokenExpired(credentials) {
    const expiry = resolveExpiry(credentials);

    if (expiry === null || expiry === undefined)
        return false;

    if (typeof expiry === 'number') {
        const millis = expiry > 1e12 ? expiry : expiry * 1000;
        return Date.now() >= millis;
    }

    const parsed = Date.parse(expiry);
    if (Number.isNaN(parsed))
        return false;

    return Date.now() >= parsed;
}

function ok(data) {
    return {ok: true, data};
}

function fail(code, message, data = null, retryAfterMs = null) {
    const result = {
        ok: false,
        error: {
            code,
            message,
        },
    };

    if (data)
        result.data = data;

    if (Number.isFinite(retryAfterMs))
        result.error.retryAfterMs = retryAfterMs;

    return result;
}

// Parses the standard Retry-After header (RFC 9110): either an integer
// number of seconds, or an HTTP-date. Returns null when absent, malformed,
// or when the response object doesn't expose headers at all (true today on
// both the KDE XHR runtime and the GNOME Soup runtime; this degrades to the
// caller's fallback backoff in that case, never throws).
function parseRetryAfterMs(response, nowMsFn) {
    const headers = response?.headers;
    if (!headers || typeof headers.get !== 'function')
        return null;

    const raw = headers.get('retry-after');
    if (raw === null || raw === undefined)
        return null;

    const trimmed = String(raw).trim();
    if (/^\d+$/.test(trimmed))
        return Math.max(0, Number(trimmed) * 1000);

    const parsedMs = Date.parse(trimmed);
    if (Number.isNaN(parsedMs))
        return null;

    return Math.max(0, parsedMs - nowMsFn());
}

function failFromResponse(response, code, message, nowMsFn) {
    const retryAfterMs = code === 'rate_limited' ? parseRetryAfterMs(response, nowMsFn) : null;
    return fail(code, message, null, retryAfterMs);
}

function mapHttpStatusToErrorCode(status) {
    if (status === 401 || status === 403)
        return 'auth_expired';

    if (status === 404)
        return 'schema_changed';

    if (status === 429)
        return 'rate_limited';

    if (status >= 500 && status < 600)
        return 'network_error';

    return 'network_error';
}

async function parseUsageResponse(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchUsage(fetchImpl, accessToken, nowMsFn) {
    const response = await fetchImpl(USAGE_ENDPOINT, {
        method: 'GET',
        headers: {
            'authorization': `Bearer ${accessToken}`,
            'anthropic-beta': OAUTH_BETA_HEADER,
        },
    });

    if (!response.ok) {
        return failFromResponse(
            response,
            mapHttpStatusToErrorCode(response.status),
            `Usage request failed with status ${response.status}`,
            nowMsFn,
        );
    }

    const json = await parseUsageResponse(response);
    if (!json)
        return fail('schema_changed', 'Usage endpoint returned invalid JSON');

    return ok(json);
}

async function refreshAccessToken(fetchImpl, refreshToken, nowMsFn) {
    if (!refreshToken)
        return fail('auth_expired', 'OAuth refresh token is missing');

    const body = encodeForm({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_CLIENT_ID,
    });

    const response = await fetchImpl(REFRESH_ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (!response.ok) {
        return failFromResponse(
            response,
            mapHttpStatusToErrorCode(response.status),
            `Refresh request failed with status ${response.status}`,
            nowMsFn,
        );
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        return fail('schema_changed', 'Refresh endpoint returned invalid JSON');
    }

    const accessToken = resolveAccessToken(payload);
    if (!accessToken)
        return fail('auth_expired', 'Refresh response did not include an access token');

    return ok({
        accessToken,
        expiresAt: resolveExpiry(payload),
    });
}

export function createClaudeProvider(options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const readTextFile = options.readTextFile ?? defaultReadTextFile;
    const homeDir = options.homeDir ?? globalThis.process?.env?.HOME ?? null;
    const credentialsPath = resolveCredentialsPath(homeDir, options.credentialsPath);
    const nowMsFn = options.nowMs ?? (() => Date.now());

    return {
        async getUsage() {
            if (typeof fetchImpl !== 'function')
                return fail('network_error', 'Fetch implementation is unavailable');

            let rawCredentials;
            try {
                rawCredentials = await readTextFile(credentialsPath);
            } catch {
                return fail('missing_creds', `Missing credentials at ${credentialsPath}`);
            }

            if (!rawCredentials)
                return fail('missing_creds', `Missing credentials at ${credentialsPath}`);

            let parsedCredentials;
            try {
                parsedCredentials = JSON.parse(rawCredentials);
            } catch {
                return fail('parse_error', 'Unable to parse Claude credentials JSON');
            }

            const oauthCredentials = parsedCredentials?.claudeAiOauth;
            if (!oauthCredentials)
                return fail('missing_creds', 'Missing claudeAiOauth in credentials JSON');

            let accessToken = resolveAccessToken(oauthCredentials);
            const refreshToken = resolveRefreshToken(oauthCredentials);

            try {
                if (!accessToken || isTokenExpired(oauthCredentials)) {
                    const refreshed = await refreshAccessToken(fetchImpl, refreshToken, nowMsFn);
                    if (!refreshed.ok)
                        return refreshed;

                    accessToken = refreshed.data.accessToken;
                }

                let usageResponse = await fetchUsage(fetchImpl, accessToken, nowMsFn);
                if (!usageResponse.ok && usageResponse.error.code === 'auth_expired') {
                    const refreshed = await refreshAccessToken(fetchImpl, refreshToken, nowMsFn);
                    if (!refreshed.ok)
                        return refreshed;

                    usageResponse = await fetchUsage(fetchImpl, refreshed.data.accessToken, nowMsFn);
                }

                if (!usageResponse.ok)
                    return usageResponse;

                const normalized = normalizeClaudeUsage(usageResponse.data);
                if (!normalized.hasSessionUsage && !normalized.hasWeeklyUsage)
                    return fail('schema_changed', 'Usage payload is missing expected utilization fields');

                if (!normalized.hasSessionUsage || !normalized.hasWeeklyUsage)
                    return fail('partial_data', 'Usage payload is missing one utilization field', normalized.data);

                return ok(normalized.data);
            } catch {
                return fail('network_error', 'Network request failed while calling Claude APIs');
            }
        },
    };
}

export const claudeProviderConfig = {
    CREDENTIALS_PATH,
    REFRESH_ENDPOINT,
    USAGE_ENDPOINT,
    OAUTH_BETA_HEADER,
    CLAUDE_CLIENT_ID,
};
