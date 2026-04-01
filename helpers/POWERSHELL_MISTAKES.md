# PowerShell Mistakes

## 2026-04-01

- `git status --short --branch` failed because `C:\prj\p2p\bountarr` is not a Git repository. Check for a `.git` directory before assuming Git commands are available.
- `pwsh -NoLogo -NoProfile -Command { npm install }` failed because `@sveltejs/kit@2.55.0` requires TypeScript `^5.3.3`, while the manifest specified TypeScript `6.0.2`. Keep SvelteKit peer versions aligned before installing.
- Launching `npm.cmd run preview` as a detached background process on Windows produced `Terminate batch job (Y/N)?` and the preview server exited. Prefer starting the built Node server directly for detached/background runs.
- Starting the adapter-node output with `node build` bound a process on the port but returned `Cannot GET /`. For this project the correct entrypoint is `node build/index.js`.
- `Invoke-RestMethod` against `/api/v3/openapi.json` on the live Radarr/Sonarr instances returned `404 Not Found`. Do not assume Arr exposes OpenAPI there; try Swagger endpoints or rely on the live API payloads already observed.
- `git status --short` failed because `C:\prj\p2p\bountarr` is not a Git repository. Check for `.git` before using Git status commands in this workspace.
- `npm run check; npm run test; npm run build` surfaced TypeScript errors in `src/lib/server/plex.ts` and a failed release-scoring assertion. Run the verification suite before restarting the server, and treat `downloadAllowed !== true` as a hard rejection in local release scoring.
- `npm run smoke` failed with `No connection could be made because the target machine actively refused it` because the helper assumed a server was already running on `localhost:4173`. Make the smoke helper start the built app automatically when no local listener exists.
- A direct probe to `http://localhost:4173/api/search?q=high%20potential&kind=series` failed with `actively refused it` because the local app server was not running at that moment. Restart or auto-start the built server before using app endpoints for live verification.
- After moving the view switch into an expandable menu, `npm run smoke` failed because the helper still asserted that the root HTML contains the literal `Dashboard` button. Keep the smoke assertions aligned with the current UI structure instead of hardcoding removed controls.
- Reading an `Invoke-RestMethod` failure with `$response.GetResponseStream()` failed because the exception carried `System.Net.Http.HttpResponseMessage`, not the older web-response type. Use `$response.Content.ReadAsStringAsync().Result` for the response body in this environment.
- Reading `$response.Content.ReadAsStringAsync().Result` from a caught `Invoke-RestMethod` error failed because the content stream was already disposed. For raw error bodies in PowerShell 7, prefer `Invoke-WebRequest -SkipHttpErrorCheck` and inspect `.StatusCode` plus `.Content`.
