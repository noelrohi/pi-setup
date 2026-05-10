---
name: git-commit
description: Create well-formatted Git commits using conventional commit standards. Use when the user asks to commit changes, write a commit message, or create a standard/conventional commit.
---

# Git Commit

## Workflow

1. Inspect the repository state:
   - `git status`
   - `git diff`
   - `git diff --staged`
   - `git log --oneline -5`
2. Decide what to commit:
   - If changes are staged, commit only staged changes.
   - If nothing is staged, ask whether to stage all or only specific files.
3. Review the diff for secrets, credentials, `.env` files, unrelated changes, or generated noise.
4. Match the recent commit style when possible.
5. Commit using conventional commit format:

```text
type(scope): subject

body if useful
```

## Message Rules

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

Subject:
- imperative mood: "add", not "added" or "adds"
- lowercase first letter
- no trailing period
- ideally 50 characters or fewer

Body, when needed:
- explain what and why, not how
- wrap around 72 characters
- separate from subject with a blank line

## Examples

```text
feat(auth): add password reset flow
```

```text
fix(api): handle null user responses

Deleted users returned null instead of 404, which crashed the
profile page during hydration.
```

```text
feat(api)!: require OAuth2 tokens

BREAKING CHANGE: API keys are no longer accepted.
```

## Finish

Run:
- `git status`
- `git log -1`

Report the commit hash and subject.
