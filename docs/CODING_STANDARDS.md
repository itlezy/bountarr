# Coding Standards

## Core rules

- Use `npm run validate` before shipping changes.
- Keep server logic explicit and readable; split helpers when a function starts carrying multiple concerns.
- Prefer small, named helpers over inline condition stacks when the behavior affects acquisition, release scoring, or API responses.
- Add comments only where intent is not obvious from the code.

## Backend conventions

- Use the shared backend logger instead of `console.*`.
- Log request boundaries, selection decisions, retries, external service failures, and terminal outcomes.
- Never log secrets, tokens, API keys, or full third-party payloads.
- Return clear, user-facing errors while keeping deeper operational detail in logs.

## Workspace conventions

- Runtime data belongs under `data/`.
- Helper scripts belong under `helpers/` and should be reusable, named, and documented at the top.
- Keep repo-tracked configuration declarative: `package.json` scripts, `biome.jsonc`, CI workflow, PM2 config, and README should describe the canonical workflow.
- When changing standards or operational behavior, update the matching docs in the same change.
