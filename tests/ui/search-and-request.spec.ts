import { expect, test } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { mockAppApi, mockJson, type MockApiController } from './support/mock-api';

function mobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.includes('mobile');
}

async function openSearch(
  page: import('@playwright/test').Page,
  api: MockApiController,
  query: string,
  title: string,
) {
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
  await page.getByPlaceholder('Search movies or shows').fill(query);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

async function openFilters(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^(All|Movies|Shows)$/ }).click();
}

test('desktop filter menu stays interactive above results', async ({ page }, testInfo) => {
  test.skip(mobileProject(testInfo), 'desktop-only filter layering check');

  const api = await mockAppApi(page);
  await openSearch(page, api, 'Matrix', 'The Matrix');
  const initialSearchCount = api.searchUrls.length;

  await openFilters(page);
  await expect(page.getByRole('dialog', { name: 'Search filters' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Only Available' }).click();

  await expect
    .poll(() => api.searchUrls.length, {
      message: 'availability change should trigger another search request',
    })
    .toBeGreaterThan(initialSearchCount);
  await expect.poll(() => api.searchUrls.at(-1) ?? '').toContain('availability=available-only');
});

test('mobile filter opens as a full-screen dialog', async ({ page }, testInfo) => {
  test.skip(!mobileProject(testInfo), 'mobile-only fullscreen filter check');

  const api = await mockAppApi(page);
  await openSearch(page, api, 'Matrix', 'The Matrix');
  const initialSearchCount = api.searchUrls.length;

  await openFilters(page);

  const dialog = page.getByRole('dialog', { name: 'Search filters' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.x ?? -1)).toBe(0);
  expect(Math.round(box?.width ?? 0)).toBe(page.viewportSize()?.width ?? 0);

  await dialog.getByRole('button', { name: 'Only Available' }).click();

  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => api.searchUrls.length, {
      message: 'mobile filter change should trigger another search request',
    })
    .toBeGreaterThan(initialSearchCount);
  await expect.poll(() => api.searchUrls.at(-1) ?? '').toContain('availability=available-only');
});

test('selected filter options keep the active styling marker', async ({ page }) => {
  const api = await mockAppApi(page);
  await openSearch(page, api, 'Matrix', 'The Matrix');
  await openFilters(page);

  const activeAvailability = page.getByRole('button', { name: 'Only Not Available' });
  await expect(activeAvailability).toHaveClass(/filter-option-active/);
  await expect(activeAvailability.locator('.filter-option__marker')).toBeVisible();

  const activeSort = page.getByRole('button', { name: 'Popularity' });
  await expect(activeSort).toHaveClass(/filter-option-active/);
  await expect(activeSort.locator('.filter-option__marker')).toBeVisible();
});

test('movie grab submits through the grab dialog and moves to queue view', async ({
  page,
}, testInfo) => {
  const api = await mockAppApi(page, {
    grabResponse: (body) =>
      mockJson(
        {
          existing: false,
          item: {
            ...(body.item as Record<string, unknown>),
            arrItemId: 603,
            canAdd: false,
            inArr: true,
            isExisting: true,
            isRequested: true,
            status: 'Queued in Radarr',
          },
          message: 'The Matrix was added to Radarr.',
          releaseDecision: null,
          job: {
            id: 'job-movie-603',
            itemId: 'movie:603',
            arrItemId: 603,
            kind: 'movie',
            title: 'The Matrix',
            sourceService: 'radarr',
            status: 'queued',
            attempt: 1,
            maxRetries: 3,
            currentRelease: null,
            selectedReleaser: null,
            preferredReleaser: null,
            reasonCode: null,
            failureReason: null,
            validationSummary: null,
            autoRetrying: false,
            progress: null,
            queueStatus: null,
            preferences: {
              preferredLanguage: 'English',
              subtitleLanguage: 'English',
            },
            startedAt: '2026-04-13T12:00:00.000Z',
            updatedAt: '2026-04-13T12:00:00.000Z',
            completedAt: null,
            attempts: [
              {
                attempt: 1,
                status: 'queued',
                reasonCode: null,
                releaseTitle: null,
                releaser: null,
                reason: null,
                startedAt: '2026-04-13T12:00:00.000Z',
                finishedAt: null,
              },
            ],
          },
        },
        600,
      ),
  });
  await openSearch(page, api, 'Matrix', 'The Matrix');

  const matrixCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The Matrix' }),
  });
  await matrixCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect(dialog.getByRole('button', { name: 'Grabbing...' })).toBeDisabled();
  await expect(dialog.getByLabel('Close grab confirmation')).toBeDisabled();
  await expect(dialog.getByLabel('Quality profile')).toBeDisabled();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'movie grab should submit a single request body',
    })
    .toBe(1);

  await expect(page.getByRole('dialog', { name: 'Grab title' })).toHaveCount(0);
  const confirmation = page.getByRole('status');
  await expect(confirmation).toContainText('The Matrix was added to Radarr.');
  if (mobileProject(testInfo)) {
    const box = await confirmation.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box?.x ?? -1)).toBe(0);
    expect(Math.round(box?.width ?? 0)).toBe(page.viewportSize()?.width ?? 0);
  }
  expect(api.grabBodies[0]?.seasonNumbers).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(
    page.getByText('Tracking The Matrix below so you can see what happens next.'),
  ).toBeVisible();
  await page.waitForTimeout(3_200);
  await expect(confirmation).toHaveCount(0);
});

test('movie grab confirmation ignores a rapid double submit', async ({ page }) => {
  const api = await mockAppApi(page, {
    grabResponse: (body) =>
      mockJson(
        {
          existing: false,
          item: {
            ...(body.item as Record<string, unknown>),
            arrItemId: 603,
            canAdd: false,
            inArr: true,
            isExisting: true,
            isRequested: true,
            status: 'Queued in Radarr',
          },
          message: 'The Matrix was added to Radarr.',
          releaseDecision: null,
          job: {
            id: 'job-movie-603',
            itemId: 'movie:603',
            arrItemId: 603,
            kind: 'movie',
            title: 'The Matrix',
            sourceService: 'radarr',
            status: 'queued',
            attempt: 1,
            maxRetries: 3,
            currentRelease: null,
            selectedReleaser: null,
            preferredReleaser: null,
            reasonCode: null,
            failureReason: null,
            validationSummary: null,
            autoRetrying: false,
            progress: null,
            queueStatus: null,
            preferences: {
              preferredLanguage: 'English',
              subtitleLanguage: 'English',
            },
            startedAt: '2026-04-13T12:00:00.000Z',
            updatedAt: '2026-04-13T12:00:00.000Z',
            completedAt: null,
            attempts: [],
          },
        },
        600,
      ),
  });
  await openSearch(page, api, 'Matrix', 'The Matrix');

  const matrixCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The Matrix' }),
  });
  await matrixCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Grab', exact: true }).dblclick();

  await expect(dialog.getByRole('button', { name: 'Grabbing...' })).toBeDisabled();
  await expect
    .poll(() => api.grabBodies.length, {
      message: 'rapid double-submit should still send a single grab request',
    })
    .toBe(1);
  await expect(page.getByRole('dialog', { name: 'Grab title' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
});

test('series grab defaults to season 1 and allows changing seasons', async ({ page }) => {
  const api = await mockAppApi(page);
  await openSearch(page, api, 'Andor', 'Andor');

  const andorCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Andor' }),
  });
  await andorCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();

  const season1 = dialog.getByRole('button', { name: 'Season 1' });
  const season2 = dialog.getByRole('button', { name: 'Season 2' });

  await expect(season1).toHaveAttribute('aria-pressed', 'true');
  await expect(season2).toHaveAttribute('aria-pressed', 'false');

  await season2.click();
  await expect(season2).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'series grab should submit a single request body',
    })
    .toBe(1);

  await expect(page.getByRole('dialog', { name: 'Grab title' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Andor was added to Sonarr.');
  expect(api.grabBodies[0]?.seasonNumbers).toEqual([1, 2]);
  await expect(
    page.getByText('Tracking Andor below so you can see what happens next.'),
  ).toBeVisible();
});

test('tracked series alternate grabs submit the tracked quality profile and selected season scope', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    searchResponse: () => [
      {
        id: 'series:83867',
        arrItemId: 83867,
        kind: 'series',
        title: 'Andor',
        year: 2022,
        rating: 8.4,
        poster: 'https://img.example/andor.jpg',
        overview: 'Cassian Andor begins the path toward rebellion.',
        status: 'Already in Arr',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        audioLanguages: [],
        subtitleLanguages: [],
        sourceService: 'sonarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        detail: null,
        requestPayload: {
          id: 83867,
          tvdbId: 361753,
          title: 'Andor',
          year: 2022,
          qualityProfileId: 2,
          seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
        },
      },
    ],
    grabResponse: (body) =>
      mockJson({
        existing: true,
        item: {
          ...(body.item as Record<string, unknown>),
          arrItemId: 83867,
          canAdd: false,
          inArr: true,
          isExisting: true,
          isRequested: true,
          status: 'Already in Arr',
        },
        message: 'Andor is already tracked in Sonarr. Alternate-release acquisition started.',
        releaseDecision: null,
        job: {
          id: 'job-series-83867',
          itemId: 'series:83867',
          arrItemId: 83867,
          kind: 'series',
          title: 'Andor',
          sourceService: 'sonarr',
          status: 'queued',
          attempt: 1,
          maxRetries: 3,
          currentRelease: null,
          selectedReleaser: null,
          preferredReleaser: null,
          reasonCode: null,
          failureReason: null,
          validationSummary: 'Monitoring seasons 2',
          autoRetrying: false,
          progress: null,
          queueStatus: null,
          preferences: {
            preferredLanguage: 'English',
            subtitleLanguage: 'English',
          },
          targetSeasonNumbers: [2],
          targetEpisodeIds: null,
          startedAt: '2026-04-13T12:00:00.000Z',
          updatedAt: '2026-04-13T12:00:00.000Z',
          completedAt: null,
          attempts: [],
        },
      }),
  });
  await openSearch(page, api, 'Andor', 'Andor');

  const andorCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Andor' }),
  });
  await andorCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Arr is already tracking this title. Confirm to download an alternate release anyway.',
  );

  const season1 = dialog.getByRole('button', { name: 'Season 1' });
  const season2 = dialog.getByRole('button', { name: 'Season 2' });
  await season1.click();
  await season2.click();
  await expect(season1).toHaveAttribute('aria-pressed', 'false');
  await expect(season2).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'tracked series alternate grab should submit a single request body',
    })
    .toBe(1);

  expect(api.grabBodies[0]?.qualityProfileId).toBe(2);
  expect(api.grabBodies[0]?.seasonNumbers).toEqual([2]);
  await expect(page.getByRole('status')).toContainText(
    'Andor is already tracked in Sonarr. Alternate-release acquisition started.',
  );
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
});

test('plex-available search results still use the normal grab dialog with confirmation', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    searchResponse: () => [
      {
        id: 'movie:603',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        rating: 8.7,
        poster: null,
        overview: 'Sci-fi',
        status: 'Available in Plex',
        isExisting: false,
        isRequested: false,
        auditStatus: 'pending',
        audioLanguages: [],
        subtitleLanguages: [],
        sourceService: 'plex',
        origin: 'merged',
        inArr: false,
        inPlex: true,
        plexLibraries: ['Movies'],
        canAdd: false,
        detail: null,
        requestPayload: { tmdbId: 603 },
      },
    ],
  });
  await openSearch(page, api, 'Matrix', 'The Matrix');

  const matrixCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The Matrix' }),
  });
  await matrixCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Plex already has this title. Confirm to download an alternate release anyway.',
  );

  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'plex-available result should still submit through the standard grab flow',
    })
    .toBe(1);
  await expect(page.getByRole('dialog', { name: 'Grab title' })).toHaveCount(0);
});

test('plex-only search results resolve into the normal grab dialog', async ({ page }) => {
  const api = await mockAppApi(page, {
    searchResponse: () => [
      {
        id: 'plex:movie:2105',
        kind: 'movie',
        title: 'American Pie',
        year: 1999,
        rating: 7.0,
        poster: null,
        overview: 'Comedy',
        status: 'Available in Plex',
        isExisting: false,
        isRequested: false,
        auditStatus: 'pending',
        audioLanguages: [],
        subtitleLanguages: [],
        sourceService: 'plex',
        origin: 'plex',
        inArr: false,
        inPlex: true,
        plexLibraries: ['Movies'],
        canAdd: false,
        detail: null,
        requestPayload: { Guid: [{ id: 'tmdb://2105' }] },
      },
    ],
    resolveGrabResponse: () => ({
      id: 'movie:2105',
      arrItemId: null,
      kind: 'movie',
      title: 'American Pie',
      year: 1999,
      rating: 7.0,
      poster: null,
      overview: 'Comedy',
      status: 'Available in Plex',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'radarr',
      origin: 'merged',
      inArr: false,
      inPlex: true,
      plexLibraries: ['Movies'],
      canAdd: false,
      detail: null,
      requestPayload: { tmdbId: 2105 },
    }),
  });
  await openSearch(page, api, 'American', 'American Pie');

  const resultCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'American Pie' }),
  });
  await resultCard.getByRole('button', { name: 'Grab' }).click();

  await expect
    .poll(() => api.resolveGrabBodies.length, {
      message: 'plex-only result should be resolved before opening the grab dialog',
    })
    .toBe(1);

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Plex already has this title. Confirm to download an alternate release anyway.',
  );
});

test('arr-tracked search results still use the normal grab dialog with alternate-release confirmation', async ({
  page,
}) => {
  const api = await mockAppApi(page, {
    searchResponse: () => [
      {
        id: 'movie:603',
        arrItemId: 603,
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        rating: 8.7,
        poster: null,
        overview: 'Sci-fi',
        status: 'Already in Arr',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        audioLanguages: [],
        subtitleLanguages: [],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        detail: null,
        requestPayload: { id: 603, tmdbId: 603 },
      },
    ],
    grabResponse: (body) =>
      mockJson({
        existing: true,
        item: {
          ...(body.item as Record<string, unknown>),
          arrItemId: 603,
          canAdd: false,
          inArr: true,
          isExisting: true,
          isRequested: true,
          status: 'Already in Arr',
        },
        message: 'The Matrix is already tracked in Radarr. Alternate-release acquisition started.',
        releaseDecision: null,
        job: {
          id: 'job-movie-603-alt',
          itemId: 'movie:603',
          arrItemId: 603,
          kind: 'movie',
          title: 'The Matrix',
          sourceService: 'radarr',
          status: 'queued',
          attempt: 1,
          maxRetries: 3,
          currentRelease: null,
          selectedReleaser: null,
          preferredReleaser: 'flux',
          reasonCode: null,
          failureReason: null,
          validationSummary: null,
          autoRetrying: false,
          progress: null,
          queueStatus: null,
          preferences: {
            preferredLanguage: 'English',
            subtitleLanguage: 'English',
          },
          startedAt: '2026-04-13T12:00:00.000Z',
          updatedAt: '2026-04-13T12:00:00.000Z',
          completedAt: null,
          attempts: [],
        },
      }),
  });
  await openSearch(page, api, 'Matrix', 'The Matrix');

  const matrixCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The Matrix' }),
  });
  await matrixCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Arr is already tracking this title. Confirm to download an alternate release anyway.',
  );

  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'tracked Arr result should still submit through the standard grab flow',
    })
    .toBe(1);
  await expect(page.getByRole('dialog', { name: 'Grab title' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Alternate-release acquisition started.');
});

test('duplicate tracked movie submit still moves to queue and keeps alternate-release guidance', async ({
  page,
}) => {
  const duplicateJob = {
    id: 'job-movie-603-duplicate',
    itemId: 'movie:603',
    arrItemId: 603,
    kind: 'movie',
    title: 'The Matrix',
    sourceService: 'radarr',
    status: 'queued',
    attempt: 1,
    maxRetries: 3,
    currentRelease: null,
    selectedReleaser: null,
    preferredReleaser: 'flux',
    reasonCode: null,
    failureReason: null,
    validationSummary: null,
    autoRetrying: false,
    progress: null,
    queueStatus: null,
    preferences: {
      preferredLanguage: 'English',
      subtitleLanguage: 'English',
    },
    startedAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    completedAt: null,
    attempts: [],
  } as const;
  const api = await mockAppApi(page, {
    queue: {
      updatedAt: '2026-04-13T12:00:00.000Z',
      entries: [
        {
          kind: 'managed',
          id: duplicateJob.id,
          job: duplicateJob,
          liveQueueItems: [],
          liveSummary: null,
          canCancel: true,
          canRemove: true,
        },
      ],
      total: 1,
    },
    searchResponse: () => [
      {
        id: 'movie:603',
        arrItemId: 603,
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        rating: 8.7,
        poster: null,
        overview: 'Sci-fi',
        status: 'Already in Arr',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        audioLanguages: ['English'],
        subtitleLanguages: ['English'],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        detail: null,
        requestPayload: { id: 603, tmdbId: 603 },
      },
    ],
    grabResponse: (body) =>
      mockJson({
        existing: true,
        item: {
          ...(body.item as Record<string, unknown>),
          arrItemId: 603,
          canAdd: false,
          inArr: true,
          isExisting: true,
          isRequested: true,
          status: 'Already in Arr',
        },
        message: 'The Matrix is already tracked in Radarr. Alternate-release acquisition started.',
        releaseDecision: null,
        job: duplicateJob,
      }),
  });
  await openSearch(page, api, 'Matrix', 'The Matrix');

  const matrixCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The Matrix' }),
  });
  await matrixCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Arr is already tracking this title. Confirm to download an alternate release anyway.',
  );

  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect
    .poll(() => api.grabBodies.length, {
      message: 'duplicate tracked movie should still submit through the managed grab flow',
    })
    .toBe(1);
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Alternate-release acquisition started.');
  await expect(
    page.getByText('Tracking The Matrix below so you can see what happens next.'),
  ).toBeVisible();
  await expect(
    page.getByTestId('acquisition-job-card').filter({ hasText: 'The Matrix' }).first(),
  ).toBeVisible();
});
