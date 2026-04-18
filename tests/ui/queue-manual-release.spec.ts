import { expect, test } from '@playwright/test';
import type { Page, Request, TestInfo } from '@playwright/test';
import {
  acquisitionJobFixture,
  buildManualReleaseSelectionResponse,
  buildQueueResponse,
  buildSelectedJob,
  buildSelectedManualReleaseList,
  emptyDashboardResponse,
  emptyManualReleaseListFixture,
  manualReleaseFixture,
  manualReleaseListFixture,
  manualReleaseRejectedFixture,
  queueItemFixture,
} from './support/fixtures';
import { mockAppApi, mockJson, mockTextError, type MockApiController } from './support/mock-api';

function mobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.includes('mobile');
}

async function openQueue(page: Page, api: MockApiController) {
  await page.goto('/');
  await expect
    .poll(() => api.dashboardRequests.length, {
      message: 'app should hydrate and request the dashboard before UI interaction',
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => api.queueRequests.length, {
      message: 'app should hydrate and request the queue before UI interaction',
    })
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Queue' }).click();
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
}

function acquisitionCard(page: Page) {
  return page.locator('article').filter({
    has: page.getByRole('button', { name: /manual release options/i }),
  });
}

function managedJobCard(page: Page, title: string) {
  return page.getByTestId('acquisition-job-card').filter({ hasText: title }).first();
}

function queueItemCard(page: Page, title: string) {
  return page.getByTestId('queue-item-card').filter({ hasText: title }).first();
}

function queueEntryListItem(page: Page, title: string) {
  return page.getByTestId('queue-entry-list-item').filter({ hasText: title }).first();
}

async function selectQueueEntry(page: Page, title: string) {
  await queueEntryListItem(page, title).click();
}

async function openManualReleaseModal(page: Page) {
  const card = acquisitionCard(page);
  await card.getByRole('button', { name: 'Show manual release options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manual release options' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('queue view renders acquisition jobs and active downloads', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
  });

  await openQueue(page, api);

  await expect(managedJobCard(page, acquisitionJobFixture.title)).toBeVisible();
  await expect(queueEntryListItem(page, queueItemFixture.title)).toBeVisible();
  await expect(page.getByTestId('queue-entry-list-item')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Show operator tools' })).toHaveCount(0);
  await expect(page.getByText('Movie download · Downloading')).toBeVisible();
  await expect(page.getByText(/Show grab .*Looking for a release/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel download' })).toHaveCount(1);
});

test('queue list surfaces release detail for ambiguous same-title external downloads', async ({ page }) => {
  const firstItem = {
    ...queueItemFixture,
    id: 'radarr:queue:41',
    queueId: 41,
    title: 'The Matrix',
    detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
  };
  const secondItem = {
    ...queueItemFixture,
    id: 'radarr:queue:42',
    queueId: 42,
    title: 'The Matrix',
    detail: 'The.Matrix.1999.1080p.BluRay-OLD',
  };
  const api = await mockAppApi(page, {
    queue: buildQueueResponse([], [firstItem, secondItem]),
  });

  await openQueue(page, api);

  await expect(
    page.getByTestId('queue-entry-list-item').filter({ hasText: 'The.Matrix.1999.1080p.WEB-DL-FLUX' }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('queue-entry-list-item').filter({ hasText: 'The.Matrix.1999.1080p.BluRay-OLD' }),
  ).toHaveCount(1);
});

test('queue cards and manual release modal show the managed target scope', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => manualReleaseListFixture,
  });

  await openQueue(page, api);

  const card = acquisitionCard(page);
  await expect(card.getByText('Scope', { exact: true })).toBeVisible();
  await expect(card.getByText('Season 1', { exact: true })).toBeVisible();

  const dialog = await openManualReleaseModal(page);
  await expect(dialog.getByText('Scope', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Season 1', { exact: true })).toBeVisible();
});

test('completed managed jobs do not expose manual release actions', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse([
      {
        ...acquisitionJobFixture,
        completedAt: '2026-04-13T12:04:00.000Z',
        currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
        reasonCode: 'validated',
        status: 'completed',
        validationSummary: 'Ready to watch.',
      },
    ], []),
  });

  await openQueue(page, api);

  const card = managedJobCard(page, acquisitionJobFixture.title);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /manual release options/i })).toHaveCount(0);
});

test('queued manual selections still expose manual release actions for replacement', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse([
      {
        ...acquisitionJobFixture,
        queueStatus: 'Manual selection queued',
        status: 'queued',
        validationSummary: 'User selected Andor.S01.1080p.WEB-DL-FLUX',
      },
    ], []),
    manualReleaseResponse: () => buildSelectedManualReleaseList(),
  });

  await openQueue(page, api);

  const card = managedJobCard(page, acquisitionJobFixture.title);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /manual release options/i })).toBeVisible();

  const dialog = await openManualReleaseModal(page);
  await expect(dialog.getByRole('button', { name: 'Selected' })).toBeDisabled();
});

test('reopening manual release options refreshes queued selection state', async ({ page }) => {
  const replacementRelease = {
    ...manualReleaseFixture,
    guid: 'guid-andor-replacement',
    indexerId: 21,
    title: 'Andor.S01.1080p.WEB-DL-REPLACEMENT',
  };
  let releaseCall = 0;
  const api = await mockAppApi(page, {
    queue: buildQueueResponse([
      {
        ...acquisitionJobFixture,
        queueStatus: 'Manual selection queued',
        status: 'queued',
        validationSummary: 'User selected Andor.S01.1080p.WEB-DL-FLUX',
      },
    ], []),
    manualReleaseResponse: () => {
      releaseCall += 1;
      if (releaseCall === 1) {
        return buildSelectedManualReleaseList();
      }

      return {
        ...manualReleaseListFixture,
        releases: [
          {
            ...replacementRelease,
            canSelect: false,
            status: 'selected',
          },
          manualReleaseRejectedFixture,
        ],
        selectedGuid: replacementRelease.guid,
        summary: 'Replacement manual release is queued.',
      };
    },
  });

  await openQueue(page, api);

  let dialog = await openManualReleaseModal(page);
  await expect(dialog.getByText(manualReleaseFixture.title, { exact: true })).toBeVisible();
  await expect(dialog.getByText('One manual-search release was selected.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close manual release options' }).click();
  await expect(page.getByRole('dialog', { name: 'Manual release options' })).toHaveCount(0);

  dialog = await openManualReleaseModal(page);

  await expect
    .poll(() => api.manualReleaseRequests.length, {
      message: 'reopening manual release options should request fresh release data',
    })
    .toBe(2);
  await expect(dialog.getByText(replacementRelease.title, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Replacement manual release is queued.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Selected' })).toBeDisabled();
});

test('queue item cancel refreshes queue and dashboard state', async ({ page }) => {
  let queueCall = 0;
  const refreshedQueue = buildQueueResponse([acquisitionJobFixture], []);
  const api = await mockAppApi(page, {
    dashboard: (_request: Request, url: URL) =>
      url.pathname === '/api/dashboard/refresh'
        ? mockJson(emptyDashboardResponse)
        : emptyDashboardResponse,
    queue: () => {
      queueCall += 1;
      return queueCall > 1 ? refreshedQueue : buildQueueResponse();
    },
  });

  await openQueue(page, api);

  await selectQueueEntry(page, queueItemFixture.title);
  const downloadCard = queueItemCard(page, queueItemFixture.title);
  await expect(downloadCard).toBeVisible();
  await downloadCard.getByRole('button', { name: 'Cancel download' }).click();

  await expect
    .poll(() => api.queueCancelBodies.length, {
      message: 'queue item cancel should submit one cancel request body',
    })
    .toBe(1);
  expect(api.queueCancelBodies[0]).toEqual({
    kind: 'external',
    arrItemId: queueItemFixture.arrItemId,
    downloadId: null,
    id: queueItemFixture.id,
    queueId: queueItemFixture.queueId,
    sourceService: queueItemFixture.sourceService,
    title: queueItemFixture.title,
  });

  await expect(page.getByText('"The Matrix" download was cancelled.')).toBeVisible();
  await expect
    .poll(() => api.queueRequests.length, {
      message: 'queue should refresh after cancelling a queue item',
    })
    .toBeGreaterThan(1);
  await expect(downloadCard).toHaveCount(0);
});

test('queue item cancel errors stay inline on the queue card', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    queueCancelResponse: () => mockTextError('Unable to cancel the selected download.', 500, 150),
  });

  await openQueue(page, api);

  await selectQueueEntry(page, queueItemFixture.title);
  const downloadCard = queueItemCard(page, queueItemFixture.title);
  await expect(downloadCard).toBeVisible();
  await downloadCard.getByRole('button', { name: 'Cancel download' }).click();

  await expect(page.getByText('Unable to cancel the selected download.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(downloadCard).toBeVisible();
  await expect(downloadCard).toContainText('Unable to cancel the selected download.');
});

test('queue item cards do not expose title deletion for live external downloads', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
  });

  await openQueue(page, api);

  await selectQueueEntry(page, queueItemFixture.title);
  const downloadCard = queueItemCard(page, queueItemFixture.title);
  await expect(downloadCard).toBeVisible();
  await expect(downloadCard.getByRole('button', { name: 'Cancel download' })).toBeVisible();
  await expect(downloadCard.getByRole('button', { name: /clear stale queue entry/i })).toHaveCount(0);
  await expect(downloadCard.getByRole('button', { name: /remove from library/i })).toHaveCount(0);
});

test('stale external queue rows expose only the clear action', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: {
      updatedAt: '2026-04-18T11:05:28.375Z',
      total: 1,
      entries: [
        {
          kind: 'external',
          id: 'radarr:queue:1996958567',
          canCancel: false,
          canRemove: true,
          item: {
            id: 'radarr:queue:1996958567',
            downloadId: 'SABnzbd_nzo_4lejah9m',
            arrItemId: 727,
            canCancel: true,
            kind: 'movie',
            title: 'Dangerous Animals',
            year: 2025,
            poster: null,
            sourceService: 'radarr',
            status: 'Completed',
            statusDetail:
              'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
            trackedDownloadStatus: 'warning',
            trackedDownloadState: 'importpending',
            progress: 100,
            timeLeft: '00:00:00',
            estimatedCompletionTime: '2026-04-18T11:05:28Z',
            size: 7_845_710_150,
            sizeLeft: 0,
            queueId: 1996958567,
            detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
            episodeIds: null,
            seasonNumbers: null,
          },
        },
      ],
    },
  });

  await openQueue(page, api);

  const downloadCard = queueItemCard(page, 'Dangerous Animals');
  await expect(downloadCard).toBeVisible();
  await expect(downloadCard.getByRole('button', { name: 'Cancel download' })).toHaveCount(0);
  await expect(downloadCard.getByRole('button', { name: 'Clear stale queue entry' })).toBeVisible();
});

test('queue view shows explicit ETA for downloads and matched grab jobs', async ({ page }) => {
  const matchingAcquisitionQueueItem = {
    id: 'sonarr:queue:2',
    arrItemId: acquisitionJobFixture.arrItemId,
    canCancel: true,
    kind: acquisitionJobFixture.kind,
    title: acquisitionJobFixture.title,
    year: 2022,
    poster: 'https://img.example/andor.jpg',
    sourceService: acquisitionJobFixture.sourceService,
    status: 'Downloading',
    progress: 58,
    timeLeft: '18m',
    estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
    size: 4_000_000_000,
    sizeLeft: 1_200_000_000,
    queueId: 2,
    detail: 'Andor.S01.1080p.WEB-DL-FLUX',
    episodeIds: [101, 102],
    seasonNumbers: [1],
  };
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(
      [acquisitionJobFixture],
      [queueItemFixture, matchingAcquisitionQueueItem],
    ),
  });

  await openQueue(page, api);

  await selectQueueEntry(page, queueItemFixture.title);
  const downloadCard = page.locator('article').filter({
    has: page.getByText(queueItemFixture.title, { exact: true }),
  });
  await expect(downloadCard.getByText('75%', { exact: true })).toBeVisible();
  await expect(downloadCard.getByText('ETA', { exact: true })).toBeVisible();
  await expect(downloadCard.getByText('10m remaining', { exact: true })).toBeVisible();

  await selectQueueEntry(page, acquisitionJobFixture.title);
  const card = managedJobCard(page, acquisitionJobFixture.title);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Downloading');
  await expect(card.getByText('ETA', { exact: true }).first()).toBeVisible();
  await expect(card).toContainText('18m remaining');
  await expect(card).toContainText('Andor.S01.1080p.WEB-DL-FLUX');
});

test('queue keeps out-of-scope same-series downloads as external rows', async ({ page }) => {
  const inScopeQueueItem = {
    id: 'sonarr:queue:2',
    arrItemId: acquisitionJobFixture.arrItemId,
    canCancel: true,
    kind: acquisitionJobFixture.kind,
    title: acquisitionJobFixture.title,
    year: 2022,
    poster: 'https://img.example/andor.jpg',
    sourceService: acquisitionJobFixture.sourceService,
    status: 'Downloading',
    progress: 58,
    timeLeft: '18m',
    estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
    size: 4_000_000_000,
    sizeLeft: 1_200_000_000,
    queueId: 2,
    detail: 'Andor.S01.1080p.WEB-DL-FLUX',
    episodeIds: [101, 102],
    seasonNumbers: [1],
  };
  const outOfScopeQueueItem = {
    ...inScopeQueueItem,
    id: 'sonarr:queue:3',
    progress: 12,
    queueId: 3,
    timeLeft: '1h',
    estimatedCompletionTime: '2026-04-13T13:00:00.000Z',
    detail: 'Andor.S02E01.1080p.WEB-DL-FLUX',
    episodeIds: [201],
    seasonNumbers: [2],
  };
  const api = await mockAppApi(page, {
    queue: buildQueueResponse([acquisitionJobFixture], [inScopeQueueItem, outOfScopeQueueItem]),
  });

  await openQueue(page, api);

  const managedCard = managedJobCard(page, acquisitionJobFixture.title);
  await expect(managedCard).toBeVisible();
  await expect(managedCard).toContainText('Andor.S01.1080p.WEB-DL-FLUX');
  await expect(managedCard).not.toContainText('Andor.S02E01.1080p.WEB-DL-FLUX');

  await page.getByTestId('queue-entry-list-item').nth(1).click();
  const externalCard = queueItemCard(page, acquisitionJobFixture.title);
  await expect(externalCard).toBeVisible();
  await expect(externalCard).toContainText('Andor.S02E01.1080p.WEB-DL-FLUX');
  await expect(externalCard.getByRole('button', { name: 'Cancel download' })).toBeVisible();
});

test('queue and manual release long text wraps without breaking layout', async ({ page }) => {
  const longReleaseText = 'UltraExtendedReleaseName'.repeat(14);
  const longReason = 'ThisReasonStringHasNoNaturalBreaks'.repeat(10);
  const longReleaser = 'PreferredReleaser'.repeat(8);
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(
      [
        {
          ...acquisitionJobFixture,
          currentRelease: longReleaseText,
          preferredReleaser: longReleaser,
          validationSummary: longReason,
          attempts: acquisitionJobFixture.attempts.map((attempt, index) =>
            index === acquisitionJobFixture.attempts.length - 1
              ? {
                  ...attempt,
                  releaseTitle: longReleaseText,
                }
              : attempt,
          ),
        },
      ],
      [
        {
          ...queueItemFixture,
          title: longReleaseText,
          detail: longReleaseText,
        },
      ],
    ),
    manualReleaseResponse: () => ({
      ...manualReleaseListFixture,
      summary: longReason,
      releases: manualReleaseListFixture.releases.map((release, index) =>
        index === 0
          ? {
              ...release,
              title: longReleaseText,
              reason: longReason,
              explanation: {
                ...release.explanation,
                summary: longReason,
                arrReasons: [longReason],
              },
            }
          : release,
      ),
    }),
  });

  await openQueue(page, api);

  await expect(page.getByText(longReleaseText).first()).toBeVisible();
  const pageWidths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(pageWidths.scrollWidth).toBeLessThanOrEqual(pageWidths.clientWidth);

  const dialog = await openManualReleaseModal(page);
  await expect(dialog.getByText(longReleaseText).first()).toBeVisible();
  const dialogOverflow = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dialogOverflow.scrollWidth).toBeLessThanOrEqual(dialogOverflow.clientWidth);
});

test('manual release dialog uses responsive modal layout', async ({ page }, testInfo) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => mockJson(manualReleaseListFixture, 250),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(dialog.getByText('Loading manual-search releases...')).toBeVisible();
  await expect(dialog.getByText(manualReleaseFixture.title)).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();

  if (mobileProject(testInfo)) {
    expect(Math.round(box?.x ?? -1)).toBe(0);
    expect(Math.round(box?.width ?? 0)).toBe(page.viewportSize()?.width ?? 0);
  } else {
    expect(Math.round(box?.x ?? 0)).toBeGreaterThan(0);
    expect(Math.round(box?.width ?? 0)).toBeLessThan(page.viewportSize()?.width ?? 0);
  }
});

test('manual release dialog shows empty results and closes cleanly', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => emptyManualReleaseListFixture,
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(
    dialog.getByText('No manual-search releases are currently available.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close manual release options' }).click();
  await expect(page.getByRole('dialog', { name: 'Manual release options' })).toHaveCount(0);
});

test('manual release selection refreshes queue and release state', async ({ page }) => {
  let queueCall = 0;
  let releaseCall = 0;
  const refreshedJob = buildSelectedJob();
  const refreshedQueue = buildQueueResponse([refreshedJob], [queueItemFixture]);
  const refreshedReleases = buildSelectedManualReleaseList();
  const api = await mockAppApi(page, {
    dashboard: (_request: Request, url: URL) =>
      url.pathname === '/api/dashboard/refresh'
        ? mockJson(emptyDashboardResponse)
        : emptyDashboardResponse,
    queue: () => {
      queueCall += 1;
      return queueCall > 1 ? refreshedQueue : buildQueueResponse();
    },
    manualReleaseResponse: () => {
      releaseCall += 1;
      return releaseCall > 1 ? refreshedReleases : manualReleaseListFixture;
    },
    selectManualReleaseResponse: () => buildManualReleaseSelectionResponse(),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await dialog.getByRole('button', { name: 'Select release' }).first().click();

  await expect
    .poll(() => api.selectManualReleaseBodies.length, {
      message: 'manual release selection should submit a request body',
    })
    .toBe(1);
  expect(api.selectManualReleaseBodies[0]).toEqual({
    body: {
      guid: manualReleaseFixture.guid,
      indexerId: manualReleaseFixture.indexerId,
      selectionMode: 'direct',
    },
    jobId: acquisitionJobFixture.id,
  });

  await expect(dialog.getByText('One manual-search release was selected.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Selected' })).toBeDisabled();
  await expect(
    page.getByText('Manual release selected. Sending Andor to the downloader.'),
  ).toBeVisible();
  await expect(
    managedJobCard(page, acquisitionJobFixture.title)
      .getByText('Manual release selected and sent to the downloader.', { exact: true })
      .first(),
  ).toBeVisible();
  await expect
    .poll(() => api.queueRequests.length, {
      message: 'queue should refresh after selecting a manual release',
    })
    .toBeGreaterThan(1);
  await expect
    .poll(() => api.manualReleaseRequests.length, {
      message: 'manual release list should refresh after selecting a release',
    })
    .toBeGreaterThan(1);
});

test('manual release selection errors stay inline and keep the dialog open', async ({ page }) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => manualReleaseListFixture,
    selectManualReleaseResponse: () =>
      mockTextError('Unable to select the requested release.', 500, 150),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await dialog.getByRole('button', { name: 'Select release' }).first().click();

  await expect(dialog.getByText('Unable to select the requested release.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Manual release options' })).toBeVisible();
  await expect(page.getByText(manualReleaseFixture.title)).toBeVisible();
});

test('manual release dialog allows direct override for Arr-rejected releases', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => manualReleaseListFixture,
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  const rejectedCard = dialog.locator('article').filter({
    hasText: manualReleaseRejectedFixture.title,
  });
  await expect(rejectedCard.getByRole('button', { name: 'Override Arr rejection' })).toBeEnabled();
  await rejectedCard.getByRole('button', { name: 'Override Arr rejection' }).click();

  await expect
    .poll(() => api.selectManualReleaseBodies.length, {
      message: 'Arr-rejected manual release override should submit one selection request',
    })
    .toBe(1);
  expect(api.selectManualReleaseBodies[0]).toEqual({
    body: {
      guid: manualReleaseRejectedFixture.guid,
      indexerId: manualReleaseRejectedFixture.indexerId,
      selectionMode: 'override-arr-rejection',
    },
    jobId: acquisitionJobFixture.id,
  });
});

test('manual release dialog blocks title-mismatched releases separately from Arr overrides', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => ({
      ...manualReleaseListFixture,
      releases: [
        {
          ...manualReleaseFixture,
          title: 'Who.Am.I.1998.1080p.WEBRip.DD2.0.x264-NTb',
          canSelect: false,
          selectionMode: null,
          blockReason: 'title-mismatch',
          identityStatus: 'mismatch',
          scopeStatus: 'not-applicable',
          reason: 'Preferred releaser NTB would normally score highest.',
          explanation: {
            summary: 'Preferred releaser NTB would normally score highest.',
            matchReasons: [],
            warningReasons: ['Structured movie titles point to a different title: Who Am I'],
            arrReasons: [],
          },
          status: 'locally-rejected',
        },
      ],
      summary: 'One release is available, but it does not match the requested title safely.',
    }),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(dialog.getByText('Why this is risky')).toBeVisible();
  await expect(
    dialog.getByText('Structured movie titles point to a different title: Who Am I'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Title mismatch' })).toBeDisabled();
});

test('manual release dialog blocks releases that are outside the targeted series scope', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => ({
      ...manualReleaseListFixture,
      releases: [
        {
          ...manualReleaseFixture,
          title: 'Andor.S02.1080p.WEB-DL-FLUX',
          canSelect: false,
          selectionMode: null,
          blockReason: 'scope-mismatch',
          reason: 'Preferred releaser FLUX would normally score highest.',
          scopeStatus: 'mismatch',
          explanation: {
            summary: 'Preferred releaser FLUX would normally score highest.',
            matchReasons: [],
            warningReasons: ['Release scope targets different seasons.'],
            arrReasons: [],
          },
          status: 'locally-rejected',
        },
      ],
      summary: 'One release is available, but it does not match the targeted scope safely.',
    }),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(dialog.getByText('Why this is risky')).toBeVisible();
  await expect(dialog.getByText('Release scope targets different seasons.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Out of scope' })).toBeDisabled();
});
