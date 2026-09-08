# brainusage@altairinglorious GNOME Extension

Minimal GNOME Shell extension scaffold for GNOME 45+ (tested target: GNOME 46).

## What this includes

- Top-bar indicator labeled `Usage`
- Clean enable/disable lifecycle
- Provider wiring for Claude and Codex usage data
- Scheduler polling every 3 minutes
- Notifications at 20% remaining for both session and weekly limits

## Local checks

From repository root:

```bash
bun install
bun test
gnome-extensions pack extension --force
```

Smoke pack script output is written to `.sisyphus/evidence/task-0-pack.txt`.

## Ubuntu GNOME local packaging workflow

Run all commands from repository root.

### Pack extension zip

```bash
bash scripts/dev/pack.sh
```

Expected artifact: `brainusage@altairinglorious.shell-extension.zip` in repo root.

### Install locally (user scope)

```bash
bash scripts/dev/install.sh
```

This installs/updates `brainusage@altairinglorious` in your local GNOME extensions directory.

### Enable extension

```bash
bash scripts/dev/enable.sh
```

### Disable extension

```bash
bash scripts/dev/disable.sh
```

### Session keepalive (Claude, opt-in)

Anthropic's Claude subscription tracks usage in a 5-hour session window that
opens at your first message and closes exactly 5 hours later. If that first
message happens late in the day, the fixed window can push the next reset
later than it needs to be.

This extension can optionally send one tiny message to Claude (the smallest
model, "haiku") whenever it detects that no session window is currently
active, so the window opens right away -- e.g. at boot -- instead of at your
first real message, moving the reset earlier instead of later. This never
makes things worse: unused quota does not carry over, and the weekly limit
is unaffected. Cost: about 240 input tokens per ping, sent at most a few
times a day (a 30-minute cooldown between attempts, and never while a
session window is already open).

There is no preferences UI, so set the two `keepalive-*` keys directly. A
user-scope install (via `scripts/gnome/install.sh`) is not on the schema
search path plain `gsettings` uses, so point `GSETTINGS_SCHEMA_DIR` at the
installed extension's own `schemas/` directory:

```bash
GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/brainusage@altairinglorious/schemas \
  gsettings set org.gnome.shell.extensions.brainusage keepalive-enabled true
```

Both keys are off/default until set this way. `keepalive-command` defaults
to a ready-to-use ping; only override it if `claude` lives outside
`$HOME/.local/bin` or `$HOME/.claude/local` (GNOME Shell does not inherit
your login shell's `PATH`, so `buildShellCommand()` already prepends both to
`PATH` before running the command). `dconf-editor`, browsing to
`/org/gnome/shell/extensions/brainusage/`, works too.

After adding/changing the schema itself (not just its values), repack,
reinstall, and re-login (Wayland) or `Alt+F2 → r` (X11) per the root
`CLAUDE.md`'s GSettings notes:

```bash
bash scripts/gnome/pack.sh
bash scripts/gnome/install.sh
```

### Troubleshooting GNOME Shell logs

```bash
journalctl --user -f /usr/bin/gnome-shell
```

Useful focused variant:

```bash
journalctl --user -f /usr/bin/gnome-shell | grep -E 'brainusage@altairinglorious|extension|JS ERROR'
```
