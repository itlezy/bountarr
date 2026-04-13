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
  await expect
    .poll(() => api.searchUrls.at(-1) ?? '')
    .toContain('availability=available-only');
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
  await expect
    .poll(() => api.searchUrls.at(-1) ?? '')
    .toContain('availability=available-only');
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

test('movie request submits through the add dialog and moves to queue view', async ({ page }, testInfo) => {
  const api = await mockAppApi(page, {
    requestResponse: (body) =>
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

  const dialog = page.getByRole('dialog', { name: 'Request title' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Grab' }).click();

  await expect(dialog.getByRole('button', { name: 'Grabbing...' })).toBeDisabled();
  await expect(dialog.getByLabel('Close add confirmation')).toBeDisabled();
  await expect(dialog.getByLabel('Quality profile')).toBeDisabled();

  await expect
    .poll(() => api.requestBodies.length, {
      message: 'movie request should submit a single request body',
    })
    .toBe(1);

  await expect(page.getByRole('dialog', { name: 'Request title' })).toHaveCount(0);
  const confirmation = page.getByRole('status');
  await expect(confirmation).toContainText('The Matrix was added to Radarr.');
  if (mobileProject(testInfo)) {
    const box = await confirmation.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box?.x ?? -1)).toBe(0);
    expect(Math.round(box?.width ?? 0)).toBe(page.viewportSize()?.width ?? 0);
  }
  expect(api.requestBodies[0]?.seasonNumbers).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Request progress' })).toBeVisible();
  await expect(page.getByText('Tracking The Matrix below so you can see what happens next.')).toBeVisible();
  await page.waitForTimeout(3_200);
  await expect(confirmation).toHaveCount(0);
});

test('series request defaults to season 1 and allows changing seasons', async ({ page }) => {
  const api = await mockAppApi(page);
  await openSearch(page, api, 'Andor', 'Andor');

  const andorCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Andor' }),
  });
  await andorCard.getByRole('button', { name: 'Grab' }).click();

  const dialog = page.getByRole('dialog', { name: 'Request title' });
  await expect(dialog).toBeVisible();

  const season1 = dialog.getByRole('button', { name: 'Season 1' });
  const season2 = dialog.getByRole('button', { name: 'Season 2' });

  await expect(season1).toHaveAttribute('aria-pressed', 'true');
  await expect(season2).toHaveAttribute('aria-pressed', 'false');

  await season2.click();
  await expect(season2).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: 'Grab' }).click();

  await expect
    .poll(() => api.requestBodies.length, {
      message: 'series request should submit a single request body',
    })
    .toBe(1);

  await expect(page.getByRole('dialog', { name: 'Request title' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Andor was added to Sonarr.');
  expect(api.requestBodies[0]?.seasonNumbers).toEqual([1, 2]);
  await expect(page.getByText('Tracking Andor below so you can see what happens next.')).toBeVisible();
});
