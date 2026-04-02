# Bountarr

LAN-first request and audit UI for Radarr and Sonarr.

## Features

- unified movie/show search through Arr lookup endpoints, with optional Plex enrichment
- add missing titles directly from search, then run an app-owned acquisition job
- acquisition jobs trigger manual search, score releases, wait for import, validate language/subtitles, and retry when needed
- dashboard with recent queue/history and audio/subtitle audit badges
- local browser preferences for theme, preferred language, and subtitle requirement
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
pwsh -NoLogo -NoProfile -Command { npm install }
pwsh -NoLogo -NoProfile -Command { npm run dev }
```

## Workspace Validation

Canonical local checks:

```powershell
pwsh -NoLogo -NoProfile -Command { npm run format }
pwsh -NoLogo -NoProfile -Command { npm run lint }
pwsh -NoLogo -NoProfile -Command { npm run validate }
```

Coding and logging conventions live in [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md).

## Health & Runtime

- Runtime health is available at `/api/health`.
- Logs are written to `data/logs/backend.log`.
- Runtime state and other local app data live under `data/`.
- If startup looks wrong, check `/api/health`, then `data/logs/backend.log`, then the PM2 stdout/stderr logs if you are running under PM2.

## Smoke Test

Run the app, then execute:

```powershell
pwsh -NoLogo -NoProfile -Command { npm run smoke }
```

## Production

```powershell
pwsh -NoLogo -NoProfile -Command { npm run build }
pwsh -NoLogo -NoProfile -Command { pm2 start ecosystem.config.cjs }
```

PM2 keeps the process in `fork` mode with a restart delay and timestamped logs for simpler local operations.
