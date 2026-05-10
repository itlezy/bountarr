# Security Policy

Bountarr is a self-hosted LAN application with no built-in authentication. Treat it as an operator tool for a trusted household network.

## Supported Deployment Posture

- Run Bountarr only on a trusted LAN or behind a VPN such as Tailscale or WireGuard.
- Do not expose Bountarr directly to the public internet.
- If you publish it through a reverse proxy, put an authentication layer in front of it.
- Keep Radarr, Sonarr, and Plex credentials in `.env` or process environment variables.
- Do not commit real API keys, Plex tokens, logs, runtime data, or live media titles.

## Reporting Security Issues

Do not open a public issue with secrets, exploit details, or host-specific information.

For now, report security issues privately to the repository owner through the preferred private contact channel listed on the GitHub profile. Include:

- affected version or commit
- deployment shape
- steps to reproduce
- relevant logs with secrets removed

## Scope

Security fixes are prioritized for the current `master` branch. Local development databases and runtime state may be reset as part of a fix.
