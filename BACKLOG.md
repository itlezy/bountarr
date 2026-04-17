# Backlog

## Queue / Grab Follow-up

- Medium: replace heuristic managed/live Sonarr queue matching for scope-less rows with persisted Arr queue identity.
  Persist `queueId` or `downloadId` onto the acquisition attempt/job as soon as a live Arr row is observed, then use that identity for queue ownership and cancel instead of falling back to normalized release-title matching.

- Low/medium: narrow queued manual-release fallback to Arr/network failures only.
  The current fallback preserves operator continuity when live Arr manual-search refresh fails, but it also catches unexpected internal errors. Restrict the fallback to expected Arr/network failures and log unexpected exceptions loudly.

- Testing: stabilize the full mocked Playwright queue/manual-release suite.
  The focused mocked cases pass, but the full `tests/ui/queue-manual-release.spec.ts` run is not reliable yet because the local app server on `http://127.0.0.1:4173` can stop accepting connections mid-run. Make the full mocked suite green in one shot.

## Highest-Value Next Step

- Persist Arr queue/download identity on managed grabs so queue ownership and cancel no longer depend on release-text heuristics.
