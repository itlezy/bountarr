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

const baseUrl = process.env.BOUNTARR_URL ?? 'http://127.0.0.1:30003';
const titles = process.argv.slice(2);

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
const dashboard = await readJson<DashboardResponse>(
  '/api/dashboard?preferredLanguage=English&subtitleLanguage=English',
);

const result = [];
for (const title of titles) {
  const job = acquisition.jobs.find((entry) => entry.title === title) ?? null;
  const dashboardItem = dashboard.items.find((entry) => entry.title === title) ?? null;
  const releases = job
    ? await readJson<ManualReleaseListResponse>(`/api/acquisition/${job.id}/releases`)
    : null;

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
