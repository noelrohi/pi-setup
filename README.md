# pi-setup

Personal Pi coding agent setup.

## What's included

- `settings.json` — default provider/model/theme preferences and Pi packages
- `load-env.ts` — loads `~/.pi/agent/.env` before package extensions start
- `extensions/` — custom Pi extensions
  - `/copy-all` — copy the current user/assistant thread to clipboard
  - `/diff` — review files changed by the last agent run in an interactive diff viewer
  - `/lg` — review all local Git changes; press `o` to open a file in Zed
  - `ask_user` plus `/options` — structured questions during a run and answers to completed responses
  - `/usage` — generate Pi/Codex usage and cost reports
  - direct `webfetch` URL reader inspired by OpenCode's WebFetch tool, with guardrails for images/PDFs/binary assets
  - fish shell handling for user `!` / `!!` commands
  - custom statusline with context, cost, generation speed, Git, and pull request status
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

The bundled `extensions/web-tools/` extension provides Exa-powered web search without requiring an API key. Start Pi or run `/reload` inside Pi after changing the configuration.
