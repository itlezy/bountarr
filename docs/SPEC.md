# Bountarr Architecture

Bountarr is a local web app that sits in front of Radarr and Sonarr. It gives household users a simple grab workflow while keeping the operational details of release selection, retries, queue state, and validation visible to the operator.

## Product Model

- **Search** finds movies and series through the configured Arr services and can enrich availability with Plex when configured.
- **Grab** is the managed Arr add flow. New titles are added to Radarr or Sonarr, and existing Arr/Plex titles can enter a `Grab Again` flow for alternate releases.
- **Acquisition jobs** are Bountarr-owned state machines for searching releases, submitting grabs, tracking queue progress, validating imports, retrying failures, and recording terminal outcomes.
- **Queue** combines live Arr queue rows with Bountarr-managed acquisition jobs so the operator can distinguish managed grabs from external downloads.
- **Download checks** show recently acquired media with audit state for preferred audio and subtitle expectations.
- **Status** exposes service readiness, runtime health, storage details, local database counts, and runtime warnings.
- **Settings** stores local browser preferences for theme, card density, preferred audio, subtitle language, and browser notifications.

## Runtime Architecture

- **Frontend:** SvelteKit and Svelte 5 runes.
- **Build:** Vite with the SvelteKit Node adapter.
- **Styling:** UnoCSS utilities and local component styles.
- **Server:** Node.js process serving SvelteKit routes and API endpoints.
- **Storage:** local SQLite acquisition state under `data/`, plus browser localStorage for UI preferences.
- **External services:** Radarr, Sonarr, and optional Plex through server-side API calls.
- **Operations:** helper-backed npm scripts for build, start, smoke checks, live integration tests, and acquisition database reset.

The browser never talks directly to Radarr, Sonarr, or Plex. Server routes proxy and normalize those APIs so browser clients do not need Arr API keys.

## Managed Grab Flow

1. The user searches for a movie or series.
2. The user confirms a grab, including language, subtitle, quality profile, and series season choices when available.
3. Bountarr creates or updates the target item in Radarr or Sonarr and creates an acquisition job.
4. The acquisition job searches viable releases, scores candidates, submits a selected release, and tracks the live Arr queue.
5. After import, Bountarr validates the downloaded item against the grab preferences.
6. Failed validation can retry another viable release until the configured retry cap is reached or no acceptable releases remain.
7. Manual release tools let an operator inspect candidates and select a direct or Arr-rejection override release when automatic selection is not enough.

Acquisition state is local operational state. During refactors or local recovery, it is acceptable to reset it with `npm run reset:db`.

## Public API Surface

The API is internal to the app but stable enough to describe operationally:

- `GET /api/search` returns normalized Radarr, Sonarr, and optional Plex search results.
- `POST /api/grab` starts the managed grab flow for a normalized media item.
- `POST /api/grab/resolve` resolves Plex-only or already-available candidates into grab-ready Arr candidates.
- `GET /api/queue` returns managed and external queue entries.
- `POST /api/queue/cancel` cancels managed jobs or external Arr queue entries.
- `GET /api/dashboard` and `POST /api/dashboard/refresh` return download check data.
- `GET /api/acquisition` returns acquisition jobs.
- `GET /api/acquisition/[jobId]/releases` lists manual release candidates.
- `POST /api/acquisition/[jobId]/select` queues a manual release selection.
- `POST /api/acquisition/[jobId]/cancel` cancels a managed acquisition job.
- `POST /api/media/delete` removes supported library or queue targets from Arr.
- `GET /api/config/status` returns service readiness, quality profile choices, and runtime details.
- `GET /api/health` returns high-level runtime health.
- `GET /api/plex/recent` returns recent Plex media when Plex is configured.

## Security And Deployment

Bountarr has no authentication. It is intended for a trusted LAN and should not be exposed directly to the internet. For remote access, put it behind a VPN or an authenticated reverse proxy.

Secrets belong in `.env` or the process environment. Do not commit real API keys, Plex tokens, host-specific live test titles, logs, or runtime data.

Production deployment is a built Node app:

```powershell
npm run build
npm run start
```

PM2 is optional and uses the repository `ecosystem.config.cjs`.

## Validation

Before publishing or merging changes, run:

```powershell
npm run validate
```

Live integration tests are destructive and require explicit opt-in with `BOUNTARR_ALLOW_LIVE_INTEGRATION=1`.
