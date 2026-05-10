# Changelog

## v0.1.0 - 2026-05-10

Initial public release of Bountarr.

### Added

- LAN-first Radarr and Sonarr grab dashboard for household media discovery.
- Managed acquisition jobs with release search, validation, retries, and manual release selection.
- Queue view that combines Bountarr-managed grabs with live Arr queue entries.
- Download checks for recently acquired media with language and subtitle audit state.
- Optional Plex enrichment for search and dashboard availability context.
- Status view for service readiness, runtime health, storage, logs, and local acquisition database state.
- Local browser notifications for grab results and audit warnings.
- Public documentation for setup, operation, security posture, architecture, live test inputs, and release process.
- MIT license.

### Security

- Bountarr has no built-in authentication and is intended only for trusted LAN or VPN use.
- Real API keys, Plex tokens, logs, runtime data, and live media titles must stay out of tracked files.
