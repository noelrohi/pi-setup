---
name: codebase-documentation
description: Generate comprehensive codebase documentation for architecture, platform UI, screens, components, state, storage, and data flows. Use when the user asks to document architecture, document platform/product behavior, create docs/architecture.md, or create docs/platform.md.
---

# Codebase Documentation

Do not assume. Explore first, then write docs with actual paths, names, schemas, and flows.

## Explore

Inspect:
- entry points: `main.*`, `index.*`, `App.*`, router config
- routes/pages/screens
- components: `ui/`, `blocks/`, `features/`
- state: stores, contexts, reducers, React Query/SWR
- hooks: `use*.ts*`
- backend/API/SDK/IPC/event systems
- config: package manager files, env/config files, feature flags
- persistence: localStorage, IndexedDB, filesystem paths, DB schemas

Useful searches:
- `**/*.tsx`, `**/*.jsx`, `**/*.vue`, etc. for UI
- `**/*store*`, `**/*context*`, `**/*reducer*`
- `**/api/**`, `**/services/**`, `**/lib/**`
- `**/*.config.*`

## Architecture Doc (`docs/architecture.md`)

Cover technical implementation:
- app startup flow for new and returning users
- storage and persistence locations/schemas
- event/API systems
- data lifecycle: create, update, delete
- edge cases and initialization order

Suggested structure:

```markdown
# [Project] Architecture

## App Startup Flow
### New User
### Existing User

## Storage & Persistence
### File System
### LocalStorage / IndexedDB
### External Data

## Event System / API Integration

## Data Lifecycle
### [Entity] Creation
### [Entity] Updates
### [Entity] Deletion
```

## Platform Doc (`docs/platform.md`)

Cover product/UI behavior:
- application overview and tech stack
- visual sitemap
- screens and navigation
- visual layouts/wireframes per screen
- component hierarchy and props
- state management
- key user flows
- backend integration

Suggested structure:

```markdown
# [Project] Platform Documentation

## Application Overview
## Visual Sitemap
## Screens & Navigation
## Core Components
## State Management
## Data Flow & Logic
## Backend Integration
```

## Style

Use:
- ASCII diagrams for flows and layouts
- tables for quick reference
- real TypeScript/interfaces/schemas where available
- file paths and line references when helpful
- concise descriptions that explain purpose, not just mechanics

Avoid:
- vague phrases like "handles data"
- invented routes/components/storage
- skipping major screens or states
- ignoring happy-path vs edge-case differences

## Finish

After creating docs, update `AGENTS.md`, `CLAUDE.md`, or equivalent project guidance to reference them, for example:

```markdown
## Documentation
- `docs/architecture.md` - App startup, storage, and data lifecycle
- `docs/platform.md` - UI screens, components, and user flows
```
