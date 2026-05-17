#!/usr/bin/env node

type AcquisitionJob = {
  id: string;
  title: string;
};

type AcquisitionResponse = {
  jobs: AcquisitionJob[];
};

type ManualRelease = {
  blockReason: string | null;
  canSelect: boolean;
  reason: string;
  selectionMode: string | null;
  status: string;
  title: string;
};

type ManualReleaseListResponse = {
  releases: ManualRelease[];
  selectedGuid: string | null;
  summary: string;
};

type DashboardItem = {
  auditStatus: string;
  detail: string | null;
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
const includeAllBountarr = args.includes('--all-bountarr');
const titles = args.filter((entry) => entry !== '--all-bountarr');

if (titles.length === 0) {
  throw new Error(
    'Usage: node --experimental-strip-types helpers/helper-diagnostics-bountarr-api.ts <title> [title...]',
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

const acquisition = await readJson<AcquisitionResponse>('/api/acquisition');
const releaseLists = new Map<string, ManualReleaseListResponse | null>();

for (const title of titles) {
  const job = acquisition.jobs.find((entry) => entry.title === title) ?? null;
  releaseLists.set(
    title,
    job ? await readJson<ManualReleaseListResponse>(`/api/acquisition/${job.id}/releases`) : null,
  );
}

const dashboard = await readDashboard(includeAllBountarr);
const comparisonDashboard = includeAllBountarr ? await readDashboard(false) : null;

const result = [];
for (const title of titles) {
  const job = acquisition.jobs.find((entry) => entry.title === title) ?? null;
  const dashboardItem = dashboard.items.find((entry) => entry.title === title) ?? null;
  const recentDashboardItem =
    comparisonDashboard?.items.find((entry) => entry.title === title) ?? null;
  const releases = releaseLists.get(title) ?? null;

  result.push({
    title,
    jobId: job?.id ?? null,
    dashboard: dashboardItem
      ? {
          auditStatus: dashboardItem.auditStatus,
          detail: dashboardItem.detail,
          status: dashboardItem.status,
        }
      : null,
    recentDashboardVisible: comparisonDashboard ? recentDashboardItem !== null : null,
    releases: releases
      ? {
          count: releases.releases.length,
          selectedGuid: releases.selectedGuid,
          summary: releases.summary,
          first: releases.releases.slice(0, 5).map((release) => ({
            blockReason: release.blockReason,
            canSelect: release.canSelect,
            reason: release.reason,
            selectionMode: release.selectionMode,
            status: release.status,
            title: release.title,
          })),
        }
      : null,
  });
}

console.log(JSON.stringify(result, null, 2));
