# PowerShell Mistakes

## 2026-04-01

- `git status --short --branch` failed because `C:\prj\p2p\bountarr` is not a Git repository. Check for a `.git` directory before assuming Git commands are available.
- `pwsh -NoLogo -NoProfile -Command { npm install }` failed because `@sveltejs/kit@2.55.0` requires TypeScript `^5.3.3`, while the manifest specified TypeScript `6.0.2`. Keep SvelteKit peer versions aligned before installing.
- Launching `npm.cmd run preview` as a detached background process on Windows produced `Terminate batch job (Y/N)?` and the preview server exited. Prefer starting the built Node server directly for detached/background runs.
- Starting the adapter-node output with `node build` bound a process on the port but returned `Cannot GET /`. For this project the correct entrypoint is `node build/index.js`.
- `Invoke-RestMethod` against `/api/v3/openapi.json` on the live Radarr/Sonarr instances returned `404 Not Found`. Do not assume Arr exposes OpenAPI there; try Swagger endpoints or rely on the live API payloads already observed.
- `git status --short` failed because `C:\prj\p2p\bountarr` is not a Git repository. Check for `.git` before using Git status commands in this workspace.
