# PowerShell Mistakes

- Do not pass Windows wildcard paths such as `src\lib\server\*.test.ts` as literal `rg`
  targets. Use `rg --glob 'src/lib/server/*.test.ts' ...` so ripgrep owns the file
  filtering.
- Do not pipe directly after a `foreach (...) { ... }` statement in a one-liner. Assign
  results to an array first, then pipe the array to `ConvertTo-Json`.
- Do not call `/api/dashboard/refresh` with `Invoke-RestMethod`'s default GET method; it
  requires `-Method Post`.
- When POSTing to local SvelteKit endpoints with `Invoke-RestMethod`, include a JSON body and
  `Content-Type: application/json`; the default form-style POST trips CSRF protection.
- PM2 log files may include the process id suffix, such as `bountarr-error-4.log`; list
  `C:\Users\macius\.pm2\logs` before reading an assumed log path.
- For TS helper flags that take `TITLE=VALUE`, quote the whole value when the title has spaces:
  use `--expect-audit "Soylent Green=verified"`, not `--expect-audit "Soylent Green"=verified`.
