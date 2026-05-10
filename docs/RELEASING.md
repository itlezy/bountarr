# Releasing Bountarr

This project is published as a GitHub app repository, not as an npm package. `package.json` stays private to prevent accidental npm publication.

## v0.1.0 Checklist

Run these commands from the repository root:

```powershell
npm ci
npm run validate
git status --short
```

Review the working tree carefully. Do not include local secrets, logs, runtime state, real live-wire media titles, or generated data:

- `.env`
- `data/`
- `*.log`
- `live-wire-inputs.local.json`
- real Radarr, Sonarr, or Plex API keys
- real household media titles used for destructive live tests

After review, commit the release prep:

```powershell
git add README.md docs CHANGELOG.md LICENSE SECURITY.md live-wire-inputs.example.json package.json package-lock.json
git commit -m "Prepare v0.1.0 release"
```

Create an annotated tag and push it:

```powershell
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin master
git push origin v0.1.0
```

Use `docs/releases/v0.1.0.md` as the GitHub release body.

## Release Notes Rules

- Keep release notes focused on user-visible behavior, operations, security posture, and upgrade notes.
- Mention destructive or local-state changes clearly.
- Keep real live-wire titles and machine-specific paths out of release notes.
- Run `npm run validate` before tagging.
