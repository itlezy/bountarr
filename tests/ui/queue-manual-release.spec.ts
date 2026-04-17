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

function queueItemCard(page: Page, title: string) {
  return page.getByTestId('queue-item-card').filter({ hasText: title }).first();
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

  await expect(page.getByText(acquisitionJobFixture.title, { exact: true })).toBeVisible();
  await expect(page.getByText(queueItemFixture.title, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show operator tools' })).toHaveCount(0);
  await expect(page.getByText('Movie download · Downloading')).toBeVisible();
  await expect(page.getByText(/Show grab .*Looking for a release/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel download' })).toHaveCount(2);
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
    id: queueItemFixture.id,
    queueId: queueItemFixture.queueId,
    sourceService: queueItemFixture.sourceService,
    title: queueItemFixture.title,
  });

  await expect(page.getByText('The Matrix download was cancelled.')).toBeVisible();
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

  const downloadCard = queueItemCard(page, queueItemFixture.title);
  await expect(downloadCard).toBeVisible();
  await downloadCard.getByRole('button', { name: 'Cancel download' }).click();

  await expect(page.getByText('Unable to cancel the selected download.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(downloadCard).toBeVisible();
  await expect(downloadCard).toContainText('Unable to cancel the selected download.');
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

  const downloadCard = page.locator('article').filter({
    has: page.getByText(queueItemFixture.title, { exact: true }),
  });
  await expect(downloadCard.getByText('75%', { exact: true })).toBeVisible();
  await expect(downloadCard.getByText('ETA', { exact: true })).toBeVisible();
  await expect(downloadCard.getByText('10m remaining', { exact: true })).toBeVisible();

  const card = acquisitionCard(page);
  await expect(card.getByText('58%', { exact: true }).first()).toBeVisible();
  await expect(card).toContainText('Downloading');
  await expect(card.getByText('ETA', { exact: true }).first()).toBeVisible();
  await expect(card).toContainText('18m remaining');
  await expect(card).toContainText('Andor.S01.1080p.WEB-DL-FLUX');
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
              rejectionReasons: [longReason],
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
    },
    jobId: acquisitionJobFixture.id,
  });

  await expect(dialog.getByText('One manual-search release was selected.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Selected' })).toBeDisabled();
  await expect(
    page.getByText('Manual release selected. Sending Andor to the downloader.'),
  ).toBeVisible();
  await expect(
    acquisitionCard(page)
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

test('manual release dialog disables releases that Arr already marked as not downloadable', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    queue: buildQueueResponse(),
    manualReleaseResponse: () => manualReleaseListFixture,
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(dialog.getByRole('button', { name: 'Select release' }).first()).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Not downloadable' })).toBeDisabled();
});

test('manual release dialog shows title-mismatch warnings while still allowing manual override', async ({
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
          identityReason: 'Structured movie titles point to a different title: Who Am I',
          identityStatus: 'mismatch',
          reason: 'Preferred releaser NTB would normally score highest.',
          status: 'locally-rejected',
        },
      ],
      summary: 'One release is available, but it does not match the requested title safely.',
    }),
  });

  await openQueue(page, api);
  const dialog = await openManualReleaseModal(page);

  await expect(dialog.getByText(/Title mismatch:/)).toBeVisible();
  await expect(
    dialog.getByText('Structured movie titles point to a different title: Who Am I'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Select release' })).toBeEnabled();
});
