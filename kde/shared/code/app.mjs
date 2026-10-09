// KDE plasmoid application wiring. Imports the shared core (bundled by
// scripts/kde/pack.sh via `bun build`, which inlines ../../../shared/index.mjs)
// and exposes a tiny createApp() facade that QML drives. All scheduling,
// OAuth, normalization and view-model logic lives in the shared core; this
// file only adapts it to platform primitives injected from QML.

import {
    createScheduler,
    createClaudeProvider,
    createCodexProvider,
    createThresholdNotifier,
    createKeepalive,
    buildUsageViewModel,
    DEFAULT_POLL_INTERVAL_MS,
    PANEL_LABEL_MODES,
} from '../../../shared/index.mjs';

// No-op timer functions. The plasmoid drives polling from a QML Timer calling
// refresh(); we never call scheduler.start(). These stubs are passed so the
// scheduler factory never references globalThis.setInterval — which does not
// exist on Qt 5.15's QML engine and would throw on evaluation.
function noopSetInterval() { return 0; }
function noopClearInterval() {}

const MODE_LABELS = {
    'min': 'All (minimum)',
    'claude-session': 'Claude Session',
    'claude-weekly': 'Claude Weekly',
    'codex-session': 'Codex Session',
    'codex-weekly': 'Codex Weekly',
};

export {PANEL_LABEL_MODES, DEFAULT_POLL_INTERVAL_MS};

export function modeLabel(mode) {
    return MODE_LABELS[mode] || mode;
}

// The internal provider/view-model key for the optional second Claude
// account. Not user-facing; only secondClaudeLabel and secondClaudeCredentialsPath are.
const SECOND_CLAUDE_KEY = 'claude2';

// deps: { fetchImpl, readTextFile, homeDir, notify, onUpdate, isEnabled, getCommand, runCommand,
//         claudeLabel, secondClaudeCredentialsPath, secondClaudeLabel }
//  - fetchImpl/readTextFile: from runtime.js (XHR-backed)
//  - homeDir: resolved in QML via StandardPaths (no trailing slash)
//  - notify(title, body): triggers a QML Notification
//  - onUpdate(summary): called whenever provider state changes (re-render hook)
//  - isEnabled(): reads Plasmoid.configuration.keepaliveEnabled live
//  - getCommand(): reads Plasmoid.configuration.keepaliveCommand live
//  - runCommand(shellCommand): runs it through the executable DataSource,
//    resolving to {exitCode, stderr}
//  - claudeLabel: card label for the primary Claude account (default 'Claude')
//  - secondClaudeCredentialsPath: credentials file for a second Claude
//    account; empty/absent means no second provider is created (default)
//  - secondClaudeLabel: card label for the second Claude account (default 'Claude 2')
export function createApp(deps) {
    deps = deps || {};
    const fetchImpl = deps.fetchImpl;
    const readTextFile = deps.readTextFile;
    const homeDir = deps.homeDir || null;
    const notify = typeof deps.notify === 'function' ? deps.notify : function () {};
    const onUpdate = typeof deps.onUpdate === 'function' ? deps.onUpdate : function () {};
    const isEnabled = typeof deps.isEnabled === 'function' ? deps.isEnabled : function () { return false; };
    const getCommand = typeof deps.getCommand === 'function' ? deps.getCommand : function () { return ''; };
    const runCommand = typeof deps.runCommand === 'function' ? deps.runCommand : null;
    const claudeLabel = typeof deps.claudeLabel === 'string' && deps.claudeLabel.length > 0
        ? deps.claudeLabel
        : 'Claude';
    const secondClaudeCredentialsPath = typeof deps.secondClaudeCredentialsPath === 'string'
        ? deps.secondClaudeCredentialsPath.trim()
        : '';
    const secondClaudeLabel = typeof deps.secondClaudeLabel === 'string' && deps.secondClaudeLabel.length > 0
        ? deps.secondClaudeLabel
        : 'Claude 2';

    const claude = createClaudeProvider({fetch: fetchImpl, readTextFile, homeDir});
    const codex = createCodexProvider({fetch: fetchImpl, readTextFile, homeDir});

    const providers = {claude, codex};
    const notifierProviders = [
        {key: 'claude', label: claudeLabel},
        {key: 'codex', label: 'Codex'},
    ];

    // Registering the second provider under its own key is what gives it its
    // own independent poll/backoff/state in the provider-count-agnostic
    // scheduler/aggregate/state core: a missing or unreadable second
    // credentials file fails only this provider's getUsage(), never the
    // others.
    if (secondClaudeCredentialsPath) {
        providers[SECOND_CLAUDE_KEY] = createClaudeProvider({
            fetch: fetchImpl,
            readTextFile,
            homeDir,
            credentialsPath: secondClaudeCredentialsPath,
        });
        notifierProviders.push({key: SECOND_CLAUDE_KEY, label: secondClaudeLabel});
    }

    const notifier = createThresholdNotifier({notifyFn: notify, providers: notifierProviders});
    const keepalive = createKeepalive({
        isEnabled: isEnabled,
        getCommand: getCommand,
        runCommand: runCommand,
        now: function () { return Date.now(); },
        log: function (message) { console.log(message); },
    });

    let lastSummary = null;

    const scheduler = createScheduler({
        providers: providers,
        setIntervalFn: noopSetInterval,
        clearIntervalFn: noopClearInterval,
        keepalive: keepalive,
        onUpdate: function (summary) {
            lastSummary = summary;
            notifier.evaluate(summary);
            onUpdate(summary);
        },
    });

    return {
        refresh: function (options) { return scheduler.refresh(options); },
        getSummary: function () { return scheduler.getSummary(); },
        // Build the render view-model for the current summary at the current time.
        viewModel: function (panelLabelMode) {
            return buildUsageViewModel(lastSummary, {
                now: Date.now(),
                pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
                panelLabelMode: panelLabelMode || 'min',
                claudeLabel: claudeLabel,
                secondClaudeKey: secondClaudeCredentialsPath ? SECOND_CLAUDE_KEY : null,
                secondClaudeLabel: secondClaudeLabel,
            });
        },
    };
}
