# Bountarr

LAN-first household request concierge for Radarr and Sonarr, with queue follow-through, download checks, and embedded operator tools.

## Features

- unified movie/show search with optional Plex enrichment and household-friendly availability states
- guided request flow that sends new requests into Queue and explains what happens next
- app-owned acquisition jobs that search releases, validate imports, retry automatically, and expose operator-only manual release tools
- download checks view that surfaces missing audio/subtitle problems before verified items
- operator support views for queue control, runtime health, and local preferences
- browser notifications for request results and audit failures

## Configuration

Copy `.env.example` to `.env` and set:

- `RADARR_URL`
- `RADARR_API_KEY`
- `SONARR_URL`
- `SONARR_API_KEY`
- `PLEX_URL` (optional)
- `PLEX_TOKEN` (optional)
- `RADARR_QUALITY_PROFILE_NAME`
- `SONARR_QUALITY_PROFILE_NAME`
- `ACQUISITION_ATTEMPT_TIMEOUT_MINUTES`
- `ACQUISITION_MAX_RETRIES`
- `LOG_LEVEL` (optional, defaults to `info`)
- `PORT`
- `ORIGIN`

At least one Arr service must be configured.

The quality profile env vars are matched by profile name against Radarr and Sonarr. If a named profile does not exist, add requests fail immediately with a configuration error.

Backend logs are written to `data/logs/backend.log` using human-readable lines. The file rotates at 12 MiB and keeps numbered backups `backend.log.1` through `backend.log.9`.

## Development

```powershell
npm install
npm run dev
```

## Workspace Validation

Canonical local checks:

```powershell
npm run format
npm run lint
npm run validate
```

Destructive live integration tests are available for the local stack:

```powershell
$env:BOUNTARR_ALLOW_LIVE_INTEGRATION = '1'
npm run test:integration
```

The live suite reuses the current `.env`, mutates the configured Radarr stack, and deletes the test-owned movie `Dredd (2012)` during cleanup.

Coding and logging conventions live in [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md).

## Health & Runtime

- Runtime health is available at `/api/health`.
- Logs are written to `data/logs/backend.log`.
- Runtime state, smoke helper logs, and other local app data live under `data/`.
- If startup looks wrong, check `/api/health`, then `data/logs/backend.log`, then the PM2 stdout/stderr logs if you are running under PM2.

## Smoke Test

`npm run smoke` can target an already running server. If nothing is listening on the local target port, it starts the built app automatically and writes temporary helper logs under `data/runtime/smoke/`.

```powershell
npm run smoke
```

## Build And Run

```powershell
npm run build
npm run start
```

## Production

PM2 remains available as an optional process manager:

```powershell
npm run build
pm2 start ecosystem.config.cjs
```

PM2 keeps the process in `fork` mode with a restart delay and timestamped logs for simpler local operations.

## Maintenance

```powershell
npm run reset:db
```
