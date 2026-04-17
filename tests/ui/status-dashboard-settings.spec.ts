import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { emptyDashboardResponse, movieSearchItem, seriesSearchItem } from './support/fixtures';
import { mockAppApi, type MockApiController } from './support/mock-api';

async function hydrateApp(page: Page, api: MockApiController) {
  await page.goto('/');
  await expect
    .poll(() => api.dashboardRequests.length, {
      message: 'app should request the dashboard during hydration',
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => api.queueRequests.length, {
      message: 'app should request the queue during hydration',
    })
    .toBeGreaterThan(0);
}

test('system tab shows local volumes with drive letters and mounted paths', async ({ page }) => {
  const api = await mockAppApi(page);

  await hydrateApp(page, api);
  await page.getByRole('button', { name: 'System status' }).click();

  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  const localVolumesCard = page.locator('article').filter({
    has: page.getByText('Local volumes', { exact: true }),
  });
  await expect(localVolumesCard).toBeVisible();
  await expect(localVolumesCard.getByText('4 tracked')).toBeVisible();
  await expect(localVolumesCard.getByText('C:', { exact: true }).first()).toBeVisible();
  await expect(localVolumesCard.getByText('F:', { exact: true }).first()).toBeVisible();
  await expect(localVolumesCard.getByText('Mounted path').first()).toBeVisible();
  await expect(localVolumesCard.getByText('C:\\', { exact: true })).toBeVisible();
  await expect(localVolumesCard.getByText('F:\\', { exact: true })).toBeVisible();
  await expect(localVolumesCard.getByText('C:\\M\\Archive\\', { exact: true })).toBeVisible();
  await expect(localVolumesCard.getByText('C:\\M\\Full\\', { exact: true })).toBeVisible();
  await expect(localVolumesCard.getByText('50% used').first()).toBeVisible();
  await expect(localVolumesCard.getByText('76% used')).toBeVisible();
  await expect(localVolumesCard.getByText('100% used')).toBeVisible();
  await expect(localVolumesCard.getByText('0 B free / 14.55 TB total')).toBeVisible();
});

test('download checks groups attention, pending, and verified items', async ({ page }) => {
  const api = await mockAppApi(page, {
    dashboard: {
      ...emptyDashboardResponse,
      items: [
        {
          ...movieSearchItem,
          id: 'movie:attention',
          title: 'Needs Dub',
          arrItemId: 101,
          status: 'Downloaded',
          inArr: true,
          isExisting: true,
          isRequested: true,
          canAdd: false,
          auditStatus: 'missing-language',
          audioLanguages: ['French'],
          subtitleLanguages: ['English'],
          detail: 'C:\\Media\\Movies\\Needs.Dub.mkv',
        },
        {
          ...seriesSearchItem,
          id: 'series:pending',
          title: 'Queued Check',
          arrItemId: 202,
          status: 'Downloading',
          inArr: true,
          isExisting: true,
          isRequested: true,
          canAdd: false,
          auditStatus: 'pending',
          audioLanguages: [],
          subtitleLanguages: [],
          detail: 'C:\\Media\\Shows\\Queued.Check.mkv',
        },
        {
          ...movieSearchItem,
          id: 'movie:verified',
          title: 'Looks Good',
          arrItemId: 303,
          status: 'Downloaded',
          inArr: true,
          isExisting: true,
          isRequested: true,
          canAdd: false,
          auditStatus: 'verified',
          audioLanguages: ['English'],
          subtitleLanguages: ['English'],
          detail: 'C:\\Media\\Movies\\Looks.Good.mkv',
        },
      ],
      summary: {
        total: 3,
        verified: 1,
        pending: 1,
        attention: 1,
      },
    },
  });

  await hydrateApp(page, api);
  await page.getByRole('button', { name: 'Download checks' }).click();

  await expect(page.getByRole('heading', { name: 'Download checks' })).toBeVisible();
  await expect(page.getByText('Needs attention')).toBeVisible();
  await expect(page.getByText('Waiting for check')).toBeVisible();
  await expect(page.getByText('Recently verified')).toBeVisible();
  await expect(page.getByText('Needs Dub', { exact: true })).toBeVisible();
  await expect(page.getByText('Queued Check', { exact: true })).toBeVisible();
  await expect(page.getByText('Looks Good', { exact: true })).toBeVisible();
  await expect(page.getByText('Missing audio', { exact: true })).toBeVisible();
  await expect(page.getByText('Checking', { exact: true })).toBeVisible();
  await expect(page.getByText('Looks good', { exact: true })).toBeVisible();
});

test('settings changes persist across reload and refresh dashboard preferences', async ({
  page,
}) => {
  const api = await mockAppApi(page);

  await hydrateApp(page, api);
  await page.getByRole('button', { name: 'Settings' }).click();

  const initialDashboardRequestCount = api.dashboardRequests.length;
  await page.getByLabel('Preferred audio').selectOption('Japanese');
  await page.getByLabel('Subtitle language').selectOption('German');

  await expect
    .poll(
      () =>
        api.dashboardRequests.some(
          (url) =>
            url.includes('preferredLanguage=Japanese') && url.includes('subtitleLanguage=German'),
        ),
      {
        message:
          'changing language preferences should trigger a dashboard refresh with the new query values',
      },
    )
    .toBe(true);
  expect(api.dashboardRequests.length).toBeGreaterThan(initialDashboardRequestCount);

  await page.reload();
  await expect
    .poll(() => api.dashboardRequests.length, {
      message: 'app should rehydrate after reload',
    })
    .toBeGreaterThan(initialDashboardRequestCount);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Preferred audio')).toHaveValue('Japanese');
  await expect(page.getByLabel('Subtitle language')).toHaveValue('German');
});
