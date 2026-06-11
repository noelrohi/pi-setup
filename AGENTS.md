# AGENTS.md

- This repo is a personal Pi coding agent setup.
- Use Bun as the package manager; do not create or maintain `package-lock.json`.
- Prefer `bun install` for dependency updates and keep `bun.lock` committed.
- Keep config changes small and explicit.
- Use `rg` for searching and avoid scanning `node_modules` / `sessions` unless needed.
- Do not edit secrets or auth files unless explicitly asked.
- When changing Pi behavior, update `settings.json`, `models.json`, or files under `extensions/`, `skills/`, `themes/` as appropriate.
- Keep docs and agent instructions concise.
