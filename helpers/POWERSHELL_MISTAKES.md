# PowerShell Mistakes

## 2026-04-14

- `pwsh -NoLogo -NoProfile -File 'C:\bin\zscripts\U52_diskfree.ps1'` failed because the script still uses `Get-WmiObject`, which is not available in PowerShell 7. For volume queries in this environment, use `Get-CimInstance -ClassName Win32_Volume` instead.

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
- `rg -n "describe\(|it\(" src\lib\server\*.test.ts src\routes\api\**\*.test.ts` failed on Windows because ripgrep does not expand those path globs as shell patterns there. Search a concrete root like `src` and filter in the pattern instead of passing Windows-invalid wildcard paths.
- Piping an inline script to `npx vite-node --script -` failed with `ERR_INVALID_ARG_TYPE` because `vite-node` expected a real script path in this setup. For ad hoc TS execution here, prefer a temporary helper file with a concrete path or a tool that explicitly supports stdin.
- `rg -n "console\." src helpers *.js *.cjs *.ts` failed on Windows because those wildcard path arguments are not valid there. Point ripgrep at a concrete directory such as `src` or `.` and let the pattern do the filtering.
- Embedding mixed single-quote and double-quote path patterns directly inside a PowerShell `rg` one-liner triggered a parser error around `\"./...`. On Windows PowerShell, keep complex ripgrep patterns in single-quoted literals or split them into simpler commands instead of nesting quote styles.
- Packing `Start-Job`, `Invoke-RestMethod`, and a pipeline into one quoted `pwsh -Command` line produced `An empty pipe element is not allowed` because the nested quoting/pipeline boundaries became ambiguous. For background server verification, use a proper script block or a helper `.ps1` file instead of a dense inline one-liner.
- Running Playwright `webServer` through `npm run dev` was unreliable on Windows because the batch wrapper could exit early under process supervision. Launch the Vite Node entrypoint from a dedicated PowerShell helper instead.
- Hash literals are case-insensitive in PowerShell; keys like 'sizeleft' and 'sizeLeft' collide. Use distinct output names when inspecting case-variant API fields.
- Running two `git commit` commands in parallel in the same repository raced on `.git/index.lock` and mis-associated one commit message with the other batch. Serialize Git writes; do not wrap same-repo commit operations in `multi_tool_use.parallel`.
- `npm run test -- tests/integration/live-stack.test.ts` did not run the live suite because this repo's default Vitest config only includes `src/**/*.test.ts`. Use the dedicated integration config/helper instead of passing an integration path to the default test script.
- The original `helper-test-integration.ps1` invoked `vitest run tests/integration`, which still loaded the default Vitest include pattern and found no tests. The integration helper must pass a dedicated config that includes `tests/integration/**/*.test.ts`.
