# Brain Usage

Tracks your AI usage limits for **Claude** (Anthropic) and **Codex/ChatGPT** (OpenAI) and displays remaining/used percentages in your desktop panel. Available for both **GNOME Shell** and **KDE Plasma**.

![GNOME Shell 45+](https://img.shields.io/badge/GNOME_Shell-45--49-blue)
![KDE Plasma 5/6](https://img.shields.io/badge/KDE_Plasma-5_%26_6-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

## Features

- Session and weekly usage tracking for Claude and Codex
- Color-coded progress bars (green / yellow / red) based on remaining percentage
- Configurable panel display: show any combination of Claude/Codex session and week values
- Provider icons in the panel and popup
- Toggle the panel percentage between remaining and used
- Desktop notifications when usage drops below 20%
- Auto-refresh every 3 minutes with manual refresh option
- Dark theme with modern card-based popup design

## Prerequisites

- GNOME Shell 45–49, **or** KDE Plasma 5 / 6
- Active [Claude](https://claude.ai) and/or [Codex](https://chatgpt.com) accounts with OAuth credentials on disk:
  - Claude: `~/.claude/.credentials.json`
  - Codex: `~/.codex/auth.json`

These credential files are created automatically when you sign in to the respective CLI tools ([Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex)).

## Installation — GNOME

### From GitHub Releases (recommended)

1. Download the latest `brainusage@altairinglorious.shell-extension.zip` from [Releases](https://github.com/AltairInglorious/brainusage/releases/latest)

2. Install via terminal:

   ```bash
   gnome-extensions install --force brainusage@altairinglorious.shell-extension.zip
   ```

3. Restart GNOME Shell:
   - **Wayland**: log out and log back in
   - **X11**: press `Alt+F2`, type `r`, press Enter

4. Enable the extension:
   ```bash
   gnome-extensions enable brainusage@altairinglorious
   ```

### From source

```bash
git clone https://github.com/AltairInglorious/brainusage.git
cd brainusage
bash scripts/gnome/pack.sh
bash scripts/gnome/install.sh
# Restart GNOME Shell (see above), then:
bash scripts/gnome/enable.sh
```

## Installation — KDE Plasma

### From GitHub Releases

1. Download the `.plasmoid` matching your Plasma version from [Releases](https://github.com/AltairInglorious/brainusage/releases/latest):
   - Plasma 6: `brainusage-plasma6.plasmoid`
   - Plasma 5: `brainusage-plasma5.plasmoid`

2. Install it:
   ```bash
   # Plasma 6
   kpackagetool6 --type Plasma/Applet --install brainusage-plasma6.plasmoid
   # Plasma 5
   kpackagetool5 --type Plasma/Applet --install brainusage-plasma5.plasmoid
   ```

3. Add the widget: right-click your panel or desktop → **Add Widgets** → search **Brain Usage**.

### From source

```bash
git clone https://github.com/AltairInglorious/brainusage.git
cd brainusage
bash scripts/kde/install.sh   # auto-detects Plasma 5 vs 6 and installs the matching variant
```

> Building the KDE widget requires [`bun`](https://bun.sh) (used to bundle and transpile the shared core to ES2015 for the QML engine).

## Usage

Once enabled, a percentage indicator appears in the top panel. Click it to see a detailed breakdown:

- **Session** and **Weekly** usage windows for each provider in the popup
- Progress bars with color-coded status
- Time until each window resets
- Next automatic update countdown

### Panel display modes

On GNOME, open the popup and use the **Panel metrics** switches; on KDE, right-click the widget → **Configure** → **Panel label**. Choose what the panel shows:

| Mode           | Description                       |
| -------------- | --------------------------------- |
| Claude Session | Claude session value in the panel |
| Claude Week    | Claude week value in the panel    |
| Codex Session  | Codex session value in the panel  |
| Codex Week     | Codex week value in the panel     |

You can enable more than one of these at the same time, including all four values.

### Panel label style

Open the **Label style** submenu to choose how the panel names its metrics:

- **Compact**: abbreviated labels (`s`, `w`)
- **Expanded**: full labels (`Session`, `Week`)

### Panel percent mode

Open the **Percent mode** submenu to choose whether the top-bar value shows:

- **Left**: remaining percentage for every selected panel metric
- **Used**: used percentage for every selected panel metric

## Development

```bash
bun test                         # Run unit tests (shared core)
bash scripts/gnome/pack.sh       # Pack GNOME extension zip
bash scripts/gnome/install.sh    # Install GNOME extension locally
bash scripts/kde/pack.sh         # Build both .plasmoid packages
bash scripts/kde/install.sh      # Install KDE widget for the running Plasma
journalctl --user -f /usr/bin/gnome-shell  # GNOME live logs
journalctl --user -f plasmashell            # KDE live logs
```

The platform-agnostic core lives in `shared/`; GNOME and KDE each vendor it at build time. See `CLAUDE.md` for architecture and KDE-specific notes.

## License

MIT
