# pi-setup

Personal Pi coding agent setup.

## What's included

- `settings.json` — default provider/model/theme preferences
- `extensions/` — custom Pi extensions
  - `/copy-all` — copy the current user/assistant thread to clipboard
  - `/diff` — track files changed by the last agent run and open them in Zed
  - `/usage` — generate Pi/Codex usage and cost reports
  - fish shell handling for user `!` / `!!` commands
  - custom statusline
  - custom working verbs
- `themes/vercel.json` — Pi theme adapted from the Ghostty Vercel palette

## Not included

Local state and secrets are intentionally ignored:

- `auth.json`
- `sessions/`
- `.env`
- `bin/`
- logs/crash files

## Install

Clone into `~/.pi/agent` or copy the files into an existing Pi agent directory.

```bash
git clone https://github.com/rohi/pi-setup ~/.pi/agent
```

Then start Pi or run `/reload` inside Pi.
