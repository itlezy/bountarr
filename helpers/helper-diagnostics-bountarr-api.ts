#!/usr/bin/env node

type AcquisitionJob = {
  currentRelease: string | null;
  id: string;
  reasonCode: string | null;
  status: string;
  title: string;
};

type AcquisitionResponse = {
  jobs: AcquisitionJob[];
};

type ManualRelease = {
  arrOverrideMode: string | null;
  autoBlockedReason: string | null;
  autoDecision: string | null;
  blockReason: string | null;
  canSelect: boolean;
  guid: string;
  indexerId: number;
  reason: string;
  selectionMode: string | null;
  status: string;
  title: string;
  yearMatch: string | null;
};

type ManualReleaseListResponse = {
  releases: ManualRelease[];
  selectedGuid: string | null;
  summary: string;
};

type DashboardItem = {
  auditStatus: string;
  detail: string | null;
  mediaDetails?: Record<string, unknown> | null;
  requestPayload: Record<string, unknown> | null;
  status: string;
  title: string;
};

type DashboardResponse = {
  items: DashboardItem[];
};

async function readDashboard(includeAll: boolean): Promise<DashboardResponse> {
  return readJson<DashboardResponse>(
    '/api/dashboard/refresh?preferredLanguage=English&subtitleLanguage=English',
    {
      method: 'POST',
      body: JSON.stringify({
        includeAllBountarr: includeAll,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

const baseUrl = process.env.BOUNTARR_URL ?? 'http://127.0.0.1:30003';
const args = process.argv.slice(2);
type Expectation =
  | { kind: 'visible'; title: string }
  | { kind: 'recent-hidden'; title: string }
  | { kind: 'audit'; title: string; value: string }
  | { kind: 'auto-decision'; title: string; value: string }
  | { kind: 'job-status'; title: string; value: string }
  | { kind: 'releases'; title: string }
  | { kind: 'review'; title: string }
  | { kind: 'selected-title'; title: string; value: string }
  | { kind: 'year-match'; title: string; value: string };

const expectations: Expectation[] = [];
const titles: string[] = [];
let includeAllBountarr = false;

function readFlagValue(index: number, flag: string): { value: string; nextIndex: number } {
  const arg = args[index];
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) {
    return { value: arg.slice(inlinePrefix.length), nextIndex: index };
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return { value, nextIndex: index + 1 };
}

function parseTitleValue(value: string, flag: string): { title: string; value: string } {
  const separator = value.lastIndexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Expected TITLE=VALUE for ${flag}, got ${value}`);
  }

  return {
    title: value.slice(0, separator),
    value: value.slice(separator + 1),
  };
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--all-bountarr') {
    includeAllBountarr = true;
    continue;
  }

  if (arg === '--expect-visible' || arg.startsWith('--expect-visible=')) {
    const parsed = readFlagValue(index, '--expect-visible');
    expectations.push({ kind: 'visible', title: parsed.value });
    titles.push(parsed.value);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-recent-hidden' || arg.startsWith('--expect-recent-hidden=')) {
    const parsed = readFlagValue(index, '--expect-recent-hidden');
    expectations.push({ kind: 'recent-hidden', title: parsed.value });
    titles.push(parsed.value);
    includeAllBountarr = true;
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-audit' || arg.startsWith('--expect-audit=')) {
    const parsed = readFlagValue(index, '--expect-audit');
    const expectation = parseTitleValue(parsed.value, '--expect-audit');
    expectations.push({
      kind: 'audit',
      title: expectation.title,
      value: expectation.value,
    });
    titles.push(expectation.title);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-job-status' || arg.startsWith('--expect-job-status=')) {
    const parsed = readFlagValue(index, '--expect-job-status');
    const expectation = parseTitleValue(parsed.value, '--expect-job-status');
    expectations.push({
      kind: 'job-status',
      title: expectation.title,
      value: expectation.value,
    });
    titles.push(expectation.title);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-releases' || arg.startsWith('--expect-releases=')) {
    const parsed = readFlagValue(index, '--expect-releases');
    expectations.push({ kind: 'releases', title: parsed.value });
    titles.push(parsed.value);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-review' || arg.startsWith('--expect-review=')) {
    const parsed = readFlagValue(index, '--expect-review');
    expectations.push({ kind: 'review', title: parsed.value });
    titles.push(parsed.value);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-selected-title' || arg.startsWith('--expect-selected-title=')) {
    const parsed = readFlagValue(index, '--expect-selected-title');
    const expectation = parseTitleValue(parsed.value, '--expect-selected-title');
    expectations.push({
      kind: 'selected-title',
      title: expectation.title,
      value: expectation.value,
    });
    titles.push(expectation.title);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-year-match' || arg.startsWith('--expect-year-match=')) {
    const parsed = readFlagValue(index, '--expect-year-match');
    const expectation = parseTitleValue(parsed.value, '--expect-year-match');
    expectations.push({
      kind: 'year-match',
      title: expectation.title,
      value: expectation.value,
    });
    titles.push(expectation.title);
    index = parsed.nextIndex;
    continue;
  }

  if (arg === '--expect-auto-decision' || arg.startsWith('--expect-auto-decision=')) {
    const parsed = readFlagValue(index, '--expect-auto-decision');
    const expectation = parseTitleValue(parsed.value, '--expect-auto-decision');
    expectations.push({
      kind: 'auto-decision',
      title: expectation.title,
      value: expectation.value,
    });
    titles.push(expectation.title);
    index = parsed.nextIndex;
    continue;
  }

  titles.push(arg);
}

const uniqueTitles = [...new Set(titles)];

if (uniqueTitles.length === 0) {
  throw new Error(
    'Usage: node --experimental-strip-types helpers/helper-diagnostics-bountarr-api.ts [--all-bountarr] <title> [title...] [--expect-audit TITLE=STATUS] [--expect-job-status TITLE=STATUS] [--expect-selected-title TITLE=TEXT] [--expect-year-match TITLE=MATCH] [--expect-auto-decision TITLE=DECISION] [--expect-visible TITLE] [--expect-recent-hidden TITLE] [--expect-releases TITLE] [--expect-review TITLE]',
  );
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

async function readJsonOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(new URL(path, baseUrl), init);
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

const dashboard = await readDashboard(includeAllBountarr);
const comparisonDashboard = includeAllBountarr ? await readDashboard(false) : null;
const acquisition = await readJson<AcquisitionResponse>('/api/acquisition');
const releaseLists = new Map<string, ManualReleaseListResponse | null>();

for (const title of uniqueTitles) {
  const job = acquisition.jobs.find((entry) => entry.title === title) ?? null;
  releaseLists.set(
    title,
    job
      ? await readJsonOrNull<ManualReleaseListResponse>(`/api/acquisition/${job.id}/releases`)
      : null,
  );
}

const result = [];
for (const title of uniqueTitles) {
  const job = acquisition.jobs.find((entry) => entry.title === title) ?? null;
  const dashboardItem = dashboard.items.find((entry) => entry.title === title) ?? null;
  const recentDashboardItem =
    comparisonDashboard?.items.find((entry) => entry.title === title) ?? null;
  const releases = releaseLists.get(title) ?? null;
  const selectedRelease =
    releases?.selectedGuid === null
      ? null
      : (releases?.releases.find((release) => release.guid === releases.selectedGuid) ?? null);

  result.push({
    title,
    job: job
      ? {
          currentRelease: job.currentRelease,
          id: job.id,
          reasonCode: job.reasonCode,
          status: job.status,
        }
      : null,
    dashboard: dashboardItem
      ? {
          auditStatus: dashboardItem.auditStatus,
          detail: dashboardItem.detail,
          mediaDetails: dashboardItem.mediaDetails ?? null,
          acquisitionJobId:
            typeof dashboardItem.requestPayload?.acquisitionJobId === 'string'
              ? dashboardItem.requestPayload.acquisitionJobId
              : null,
          acquisitionJobStatus:
            typeof dashboardItem.requestPayload?.acquisitionJobStatus === 'string'
              ? dashboardItem.requestPayload.acquisitionJobStatus
              : null,
          acquisitionRelease:
            typeof dashboardItem.requestPayload?.acquisitionRelease === 'string'
              ? dashboardItem.requestPayload.acquisitionRelease
              : null,
          status: dashboardItem.status,
        }
      : null,
    recentDashboardVisible: comparisonDashboard ? recentDashboardItem !== null : null,
    releases: releases
      ? {
          count: releases.releases.length,
          selectedGuid: releases.selectedGuid,
          selected: selectedRelease
            ? {
                arrOverrideMode: selectedRelease.arrOverrideMode,
                autoBlockedReason: selectedRelease.autoBlockedReason,
                autoDecision: selectedRelease.autoDecision,
                blockReason: selectedRelease.blockReason,
                canSelect: selectedRelease.canSelect,
                reason: selectedRelease.reason,
                selectionMode: selectedRelease.selectionMode,
                status: selectedRelease.status,
                title: selectedRelease.title,
                yearMatch: selectedRelease.yearMatch,
              }
            : null,
          selectedTitle: selectedRelease?.title ?? null,
          summary: releases.summary,
          first: releases.releases.slice(0, 5).map((release) => ({
            arrOverrideMode: release.arrOverrideMode,
            autoBlockedReason: release.autoBlockedReason,
            autoDecision: release.autoDecision,
            blockReason: release.blockReason,
            canSelect: release.canSelect,
            reason: release.reason,
            selectionMode: release.selectionMode,
            status: release.status,
            title: release.title,
            yearMatch: release.yearMatch,
          })),
        }
      : null,
  });
}

console.log(JSON.stringify(result, null, 2));

const failures: string[] = [];

function resultFor(title: string): (typeof result)[number] | null {
  return result.find((entry) => entry.title === title) ?? null;
}

function selectedOrFirstRelease(entry: (typeof result)[number]) {
  if (entry.releases?.selected) {
    return entry.releases.selected;
  }

  return entry.releases?.first[0] ?? null;
}

for (const expectation of expectations) {
  const entry = resultFor(expectation.title);
  if (!entry) {
    failures.push(`${expectation.title}: missing diagnostic result`);
    continue;
  }

  if (expectation.kind === 'visible' && !entry.dashboard) {
    failures.push(`${expectation.title}: expected visible in selected checks view`);
  }

  if (expectation.kind === 'recent-hidden' && entry.recentDashboardVisible !== false) {
    failures.push(`${expectation.title}: expected hidden from recent checks view`);
  }

  if (expectation.kind === 'audit' && entry.dashboard?.auditStatus !== expectation.value) {
    failures.push(
      `${expectation.title}: expected audit ${expectation.value}, got ${
        entry.dashboard?.auditStatus ?? 'missing'
      }`,
    );
  }

  if (expectation.kind === 'job-status' && entry.job?.status !== expectation.value) {
    failures.push(
      `${expectation.title}: expected job status ${expectation.value}, got ${
        entry.job?.status ?? 'missing'
      }`,
    );
  }

  if (expectation.kind === 'releases' && (entry.releases?.count ?? 0) <= 0) {
    failures.push(`${expectation.title}: expected at least one manual-search release`);
  }

  if (expectation.kind === 'review') {
    if (entry.dashboard?.auditStatus !== 'release-blocked') {
      failures.push(
        `${expectation.title}: expected release-blocked review item, got ${
          entry.dashboard?.auditStatus ?? 'missing'
        }`,
      );
    }
    if (!entry.dashboard?.acquisitionJobId) {
      failures.push(`${expectation.title}: expected checks item to include an acquisition job id`);
    }
    if ((entry.releases?.count ?? 0) <= 0) {
      failures.push(`${expectation.title}: expected reviewable releases`);
    }
  }

  if (
    expectation.kind === 'selected-title' &&
    !entry.releases?.selectedTitle?.includes(expectation.value)
  ) {
    failures.push(
      `${expectation.title}: expected selected release title containing ${expectation.value}, got ${
        entry.releases?.selectedTitle ?? 'missing'
      }`,
    );
  }

  if (expectation.kind === 'year-match') {
    const release = selectedOrFirstRelease(entry);
    if (release?.yearMatch !== expectation.value) {
      failures.push(
        `${expectation.title}: expected release year match ${expectation.value}, got ${
          release?.yearMatch ?? 'missing'
        }`,
      );
    }
  }

  if (expectation.kind === 'auto-decision') {
    const release = selectedOrFirstRelease(entry);
    if (release?.autoDecision !== expectation.value) {
      failures.push(
        `${expectation.title}: expected release auto decision ${expectation.value}, got ${
          release?.autoDecision ?? 'missing'
        }`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Bountarr diagnostic expectations failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
