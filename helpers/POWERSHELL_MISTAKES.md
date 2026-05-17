# PowerShell Mistakes

- Do not pass Windows wildcard paths such as `src\lib\server\*.test.ts` as literal `rg`
  targets. Use `rg --glob 'src/lib/server/*.test.ts' ...` so ripgrep owns the file
  filtering.
- Do not pipe directly after a `foreach (...) { ... }` statement in a one-liner. Assign
  results to an array first, then pipe the array to `ConvertTo-Json`.
