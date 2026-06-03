# pi-setup

Personal Pi coding agent setup.

## What's included

- `settings.json` — default provider/model/theme preferences and Pi packages
- `load-env.ts` — loads `~/.pi/agent/.env` before package extensions start
- `extensions/` — custom Pi extensions
  - `/copy-all` — copy the current user/assistant thread to clipboard
  - `/diff` — track files changed by the last agent run and open them in Zed
  - `/usage` — generate Pi/Codex usage and cost reports
  - direct `webfetch` URL reader inspired by OpenCode's WebFetch tool, with guardrails for images/PDFs/binary assets
  - fish shell handling for user `!` / `!!` commands
  - custom statusline
  - custom working verbs
- `pi-websearch-exa@0.2.0` package — provides the `web_search` tool
- `pi-goal` package — provides `/goal` and the `pi-goal-writer` skill for persistent autonomous goals
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

`settings.json` loads `./load-env.ts` before `npm:pi-websearch-exa@0.2.0`, so the package can see `EXA_API_KEY`. Then start Pi or run `/reload` inside Pi.
