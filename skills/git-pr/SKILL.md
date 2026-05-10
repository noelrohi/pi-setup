---
name: git-pr
description: Create pull requests with multiple organized, logical commits and a clear PR summary. Use when the user asks to create a PR, split changes into commits, or prepare a pull request.
---

# Git PR

## Workflow

1. Analyze all changes:
   - `git status`
   - `git diff`
   - `git diff --staged`
   - inspect recent commits with `git log --oneline -5`
2. Group changes into logical commits.
   - Each commit should be atomic and self-contained.
   - Use conventional commit format: `type(scope): description`.
   - If grouping is ambiguous, ask the user to choose: by feature area, by change type, or single commit.
3. Create each commit:
   - stage only related files/hunks
   - commit with a specific message that explains why when useful
   - verify after each commit if the grouping is risky
4. Ensure the branch is suitable:
   - If on `main` or `master`, create a feature branch before committing/pushing when possible.
5. Push:
   - `git push -u origin HEAD`
6. Create the PR with `gh pr create`.

## Commit Types

Use: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`.

## PR Body Template

```markdown
## Summary

Brief overview of what this PR accomplishes.

## Changes

- Commit 1: description
- Commit 2: description

## Testing

Commands run and/or manual checks performed.
```

## Guidelines

Do:
- keep commits focused
- preserve unrelated user changes
- ask before destructive git operations
- include testing in the PR description
- return the PR URL

Don't:
- make one giant commit unless requested
- use vague messages like "updates"
- skip reviewing diffs
- create or push secrets
