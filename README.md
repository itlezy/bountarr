# Bountarr

LAN-first request and audit UI for Radarr and Sonarr.

## Features

- unified movie/show search through Arr lookup endpoints
- one-click request flow with duplicate detection
- dashboard with recent queue/history and audio/subtitle audit badges
- local browser preferences for theme, preferred language, and subtitle requirement
- browser notifications for request results and audit failures

## Configuration

Copy `.env.example` to `.env` and set:

- `RADARR_URL`
- `RADARR_API_KEY`
- `SONARR_URL`
- `SONARR_API_KEY`
- `PORT`
- `ORIGIN`

At least one Arr service must be configured.

## Development

```powershell
pwsh -NoLogo -NoProfile -Command { npm install }
pwsh -NoLogo -NoProfile -Command { npm run dev }
```

## Production

```powershell
pwsh -NoLogo -NoProfile -Command { npm run build }
pwsh -NoLogo -NoProfile -Command { pm2 start ecosystem.config.cjs }
```
