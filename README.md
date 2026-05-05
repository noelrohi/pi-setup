# pi-setup

Personal Pi coding agent setup.

## What's included

- `settings.json` — default provider/model/theme preferences
- `extensions/` — custom Pi extensions
  - `/copy-all` — copy the current user/assistant thread to clipboard
  - `/diff` — track files changed by the last agent run and open them in Zed
  - `/usage` — generate Pi/Codex usage and cost reports
  - Exa-powered `web_search`, `web_contents`, and `web_answer` tools
  - direct `webfetch` URL reader inspired by OpenCode's WebFetch tool
  - fish shell handling for user `!` / `!!` commands
  - custom statusline
  - custom working verbs
- `themes/vercel.json` — Pi theme adapted from the Ghostty Vercel palette

## Not included

Local state and secrets are intentionally ignored:

- `auth.json`
- `sessions/`
- `.env` — can contain `EXA_API_KEY=...` for Exa web tools
- `bin/`
- logs/crash files

## Credits

Some extensions were adapted from [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup), especially the copy-all, diff, usage, and shell-hook patterns.

## Install

Clone into `~/.pi/agent` or copy the files into an existing Pi agent directory.

```bash
git clone https://github.com/rohi/pi-setup ~/.pi/agent
```

Install extension dependencies:

```bash
bun install
# or: npm install
```

For Exa web search, add an API key to `~/.pi/agent/.env`:

```bash
EXA_API_KEY=your_key_here
```

Then start Pi or run `/reload` inside Pi.
