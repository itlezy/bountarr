# PowerShell Mistakes

- Do not pass Windows wildcard paths such as `src\lib\server\*.test.ts` as literal `rg`
  targets. Use `rg --glob 'src/lib/server/*.test.ts' ...` so ripgrep owns the file
  filtering.
