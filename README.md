# Bountarr

Bountarr is a LAN-first household media grab dashboard for Radarr and Sonarr. It gives household users a simple way to search, grab, follow, and clean up media while keeping the release-selection, validation, and runtime evidence visible enough for an operator to understand every outcome.

Bountarr owns the lifecycle of grabs it starts. Radarr and Sonarr remain the source of truth for library state, downloads, quality profiles, and file deletion. Bountarr tracks its own acquisition jobs, validates imports against the user's grab preferences, and explains whether an item is verified, waiting for release, missing a release, or blocked for manual choice.

It is designed for trusted local networks. Bountarr has no login system, so do not expose it directly to the public internet. Use a VPN such as Tailscale or WireGuard for remote access.

## Features

- unified movie and series search across Radarr, Sonarr, and optional Plex context
- guided grab flow with per-grab language, subtitle, season, and quality profile choices
- managed acquisition jobs that search releases, validate imports, retry failed grabs, and expose manual release tools
- Queue view that combines Bountarr-managed grabs with live Arr queue entries
- Download checks view sorted by newest acquisition time for recent actionable checks, with an all-Bountarr-grabs mode for cleanup and history
- operator Status view for service health, runtime details, storage, logs, and local database state
- local browser notifications for grab results and audit warnings

## Product Contract

- Bountarr is household-first: the default path is search, confirm, grab, watch status, and clean up when needed.
- A grab is successful only after Arr imports the file and Bountarr validates it against the grab's audio and subtitle preferences.
- Checks use plain outcome labels: `Not released yet`, `No release found`, `Needs manual review`, and `Looks good` should mean distinct things.
- Cleanup from checks is destructive by design: it deletes the tracked Arr item and its files after confirmation.
- Bountarr history is durable local operational state. The default checks view stays recent and actionable, while `Show all Bountarr grabs` exposes older Bountarr-owned items.
- Automation should stop for user choice when identity, scope, quality, or Arr rejection evidence is not high confidence.

## Requirements

- Node.js 22 or newer
- npm
- PowerShell 7.6 or newer for the helper-backed npm scripts on Windows
- Radarr and/or Sonarr reachable from the Bountarr server
- optional Plex server for library-aware search and dashboard enrichment

At least one Arr service must be configured. Bountarr is an app repository, not an npm library package; `package.json` intentionally remains private.

## Quick Start

```powershell
npm install
Copy-Item -LiteralPath '.env.example' -Destination '.env'
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

Edit `.env` before real use:

```dotenv
RADARR_URL=http://127.0.0.1:7878
RADARR_API_KEY=replace-me
SONARR_URL=http://127.0.0.1:8989
SONARR_API_KEY=replace-me
PLEX_URL=http://127.0.0.1:32400
PLEX_TOKEN=
RADARR_QUALITY_PROFILE_NAME=1080p-web
SONARR_QUALITY_PROFILE_NAME=1080p-web
ACQUISITION_ATTEMPT_TIMEOUT_MINUTES=90
ACQUISITION_MAX_RETRIES=
LOG_LEVEL=info
PORT=3000
ORIGIN=http://localhost:3000
```

Leave optional values blank when they do not apply. `ACQUISITION_MAX_RETRIES` is an optional safety cap; when it is blank, Bountarr can try all viable releases.

The quality profile names are matched against Radarr and Sonarr. If a configured profile name does not exist in the target service, grabs fail immediately with a configuration error.

## Production Run

Build and start the Node adapter output:

```powershell
npm run build
npm run start
```

`npm run start` loads `.env` when present and starts `build/index.js`.

PM2 is available as an optional process manager:

```powershell
npm run build
pm2 start ecosystem.config.cjs
```

The PM2 config runs a single forked process, loads `.env`, timestamps logs, and restarts with a short delay after crashes.

## Operation

- Health endpoint: `/api/health`
- Config and runtime status: `/api/config/status`
- Backend log: `data/logs/backend.log`
- Runtime data, helper logs, and acquisition database: `data/`
- Reset local acquisition state: `npm run reset:db`

Backend logs rotate at 12 MiB and keep numbered backups from `backend.log.1` through `backend.log.9`.

If startup or grabs look wrong, check the Status view first, then `/api/health`, then `data/logs/backend.log`. Most setup issues are missing API keys, unreachable Arr URLs, no root folders, or quality profile names that do not match the target service.

## Development

Canonical local checks:

```powershell
npm run format
npm run lint
npm run validate
```

`npm run validate` runs formatting checks, linting, Svelte checks, unit tests, and a production build.

`npm run smoke` can target an already running server. If nothing is listening on the local target port, it starts the built app automatically and writes temporary helper logs under `data/runtime/smoke/`.

```powershell
npm run smoke
```

Coding and logging conventions live in [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md). Current architecture notes live in [docs/SPEC.md](docs/SPEC.md).

## Live Integration Tests

Destructive live integration tests are available for a local Radarr/Sonarr stack:

```powershell
$env:BOUNTARR_ALLOW_LIVE_INTEGRATION = '1'
npm run test:integration
```

The live suite reuses the current `.env`, mutates the configured Radarr/Sonarr stack, and deletes test-owned live targets during cleanup.

Live media titles and years must stay out of tracked source, tests, and docs. Copy [live-wire-inputs.example.json](live-wire-inputs.example.json) to the ignored `live-wire-inputs.local.json` file at the repo root, then replace the synthetic values with machine-specific live targets:

```json
{
  "duplicateMovie": { "title": "Fixture Existing Movie", "year": 2000 },
  "untrackedMovie": { "title": "Fixture Disposable Movie", "year": 2001 },
  "untrackedSeries": { "title": "Fixture Disposable Series", "year": 2002 },
  "trackedMovieCandidates": ["Fixture Existing Movie", "Fixture Alternate Existing Movie"],
  "seriesCandidates": ["Fixture Disposable Series", "Fixture Alternate Disposable Series"]
}
```

Policy: commit only synthetic fixture names. Real live-wire movie and series names belong in `live-wire-inputs.local.json` or environment variables, never in tracked files.

## Security

Bountarr is unauthenticated and should only run on a trusted LAN or behind a VPN. Do not publish it through an open reverse proxy without adding an authentication layer in front of it. See [SECURITY.md](SECURITY.md) for the supported reporting and deployment posture.

## License

Bountarr is released under the [MIT License](LICENSE).
