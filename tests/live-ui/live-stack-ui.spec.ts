import { expect, test } from '@playwright/test';
import {
  assertLiveIntegrationEnabled,
  loadLiveIntegrationConfig,
} from '../integration/support/live-config';
import { getJson, pollUntil, postJson } from '../integration/support/live-http';
import {
  ensureMovieMissing,
  findMovieByTitleYear,
  getMovieById,
  listMovies,
  ensureMovieTracked,
} from '../integration/support/live-radarr';
import {
  ensureSeriesMissing,
  findSeriesByTitleYear,
} from '../integration/support/live-sonarr';

type AcquisitionJobSummary = {
  arrItemId: number;
  id: string;
  kind: 'movie' | 'series';
  sourceService: 'radarr' | 'sonarr';
  status: string;
  title: string;
};

type AcquisitionResponse = {
  jobs: AcquisitionJobSummary[];
  updatedAt: string;
};

type DeleteRequest = {
  arrItemId: number;
  id: string;
  kind: 'movie' | 'series';
  sourceService: 'radarr' | 'sonarr';
  title: string;
};

type SearchResultItem = {
  canAdd: boolean;
  inArr: boolean;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
};

type QueueResponse = {
  acquisitionJobs: AcquisitionJobSummary[];
  items: Array<{
    arrItemId: number | null;
    estimatedCompletionTime: string | null;
    id: string;
    kind: 'movie' | 'series';
    progress: number | null;
    sourceService: 'radarr' | 'sonarr';
    status: string;
    timeLeft: string | null;
    title: string;
  }>;
  total: number;
  updatedAt: string;
};

const config = loadLiveIntegrationConfig();
let activeSeriesTarget: { title: string; year: number } | null = null;

test.describe.configure({ mode: 'serial' });

function searchResultCard(page: import('@playwright/test').Page, title: string) {
  return page
    .getByTestId('search-result-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .first();
}

function acquisitionJobCard(page: import('@playwright/test').Page, title: string) {
  return page.getByTestId('acquisition-job-card').filter({ hasText: title }).first();
}

function queueItemCard(page: import('@playwright/test').Page, title: string) {
  return page.getByTestId('queue-item-card').filter({ hasText: title }).first();
}

async function selectSearchKind(
  page: import('@playwright/test').Page,
  label: 'All' | 'Movies' | 'Shows',
): Promise<void> {
  const trigger = page.getByRole('button', { name: /^(All|Movies|Shows)$/ }).first();
  const currentLabel = (await trigger.textContent())?.trim();
  if (currentLabel === label) {
    return;
  }

  await trigger.click();
  const filterDialog = page.getByRole('dialog', { name: 'Search filters' });
  if (await filterDialog.count()) {
    await filterDialog.getByRole('button', { name: label, exact: true }).click();
    return;
  }

  await page.getByRole('button', { name: label, exact: true }).click();
}

async function searchForTitle(
  page: import('@playwright/test').Page,
  title: string,
  kind: 'All' | 'Movies' | 'Shows',
): Promise<void> {
  await page.goto('/');
  const searchInput = page.getByPlaceholder('Search movies or shows');
  if (!(await searchInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Search' }).click();
  }
  await expect(searchInput).toBeVisible();
  await selectSearchKind(page, kind);
  await searchInput.fill(title);
  await page.keyboard.press('Enter');
}

async function queueResponse(): Promise<QueueResponse> {
  return getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
}

async function acquisitionResponse(): Promise<AcquisitionResponse> {
  return getJson<AcquisitionResponse>(`${config.baseUrl}/api/acquisition`);
}

async function waitForJob(
  title: string,
  kind: 'movie' | 'series',
  sourceService: 'radarr' | 'sonarr',
  timeoutMs = 90_000,
): Promise<AcquisitionJobSummary> {
  return pollUntil(async () => {
    const acquisition = await acquisitionResponse();
    return (
      acquisition.jobs.find(
        (job) => job.title === title && job.kind === kind && job.sourceService === sourceService,
      ) ?? null
    );
  }, timeoutMs);
}

async function waitForQueueDownload(
  title: string,
  kind: 'movie' | 'series',
  sourceService: 'radarr' | 'sonarr',
  timeoutMs = 120_000,
): Promise<QueueResponse['items'][number]> {
  return pollUntil(async () => {
    const queue = await queueResponse();
    return (
      queue.items.find(
        (item) =>
          item.title === title &&
          item.kind === kind &&
          item.sourceService === sourceService &&
          item.progress !== null,
      ) ?? null
    );
  }, timeoutMs, 2_000);
}

async function findAnyLiveDownload(timeoutMs = 20_000): Promise<QueueResponse['items'][number] | null> {
  try {
    return await pollUntil(async () => {
      const queue = await queueResponse();
      return queue.items.find((item) => item.progress !== null) ?? null;
    }, timeoutMs, 2_000);
  } catch {
    return null;
  }
}

async function waitForQueueToClear(
  title: string,
  kind: 'movie' | 'series',
  sourceService: 'radarr' | 'sonarr',
  timeoutMs = 45_000,
): Promise<void> {
  await pollUntil(async () => {
    const queue = await queueResponse();
    const hasJob = queue.acquisitionJobs.some(
      (job) => job.title === title && job.kind === kind && job.sourceService === sourceService,
    );
    const hasItem = queue.items.some(
      (item) => item.title === title && item.kind === kind && item.sourceService === sourceService,
    );

    return hasJob || hasItem ? null : true;
  }, timeoutMs);
}

async function cleanupMovie(): Promise<void> {
  const trackedMovie = await findMovieByTitleYear(config, config.untrackedMovie);
  const acquisition = await acquisitionResponse().catch(() => ({ jobs: [], updatedAt: '' }));
  const deleteTargets = new Map<number, DeleteRequest>();

  if (trackedMovie) {
    deleteTargets.set(trackedMovie.id, {
      arrItemId: trackedMovie.id,
      id: `movie:${trackedMovie.id}`,
      kind: 'movie',
      sourceService: 'radarr',
      title: trackedMovie.title,
    });
  }

  for (const job of acquisition.jobs) {
    if (job.title === config.untrackedMovie.title && job.kind === 'movie' && job.sourceService === 'radarr') {
      deleteTargets.set(job.arrItemId, {
        arrItemId: job.arrItemId,
        id: job.id,
        kind: 'movie',
        sourceService: 'radarr',
        title: job.title,
      });
    }
  }

  for (const target of deleteTargets.values()) {
    try {
      await postJson(`${config.baseUrl}/api/media/delete`, target);
    } catch {
      // Fall through to direct Arr cleanup below.
    }
  }

  await ensureMovieMissing(config, config.untrackedMovie);
  await waitForQueueToClear(config.untrackedMovie.title, 'movie', 'radarr');
}

async function cleanupSeries(target = config.untrackedSeries): Promise<void> {
  if (!config.sonarrUrl || !config.sonarrApiKey) {
    return;
  }

  const trackedSeries = await findSeriesByTitleYear(config, target);
  const acquisition = await acquisitionResponse().catch(() => ({ jobs: [], updatedAt: '' }));
  const deleteTargets = new Map<number, DeleteRequest>();

  if (trackedSeries) {
    deleteTargets.set(trackedSeries.id, {
      arrItemId: trackedSeries.id,
      id: `series:${trackedSeries.id}`,
      kind: 'series',
      sourceService: 'sonarr',
      title: trackedSeries.title,
    });
  }

  for (const job of acquisition.jobs) {
    if (job.title === target.title && job.kind === 'series' && job.sourceService === 'sonarr') {
      deleteTargets.set(job.arrItemId, {
        arrItemId: job.arrItemId,
        id: job.id,
        kind: 'series',
        sourceService: 'sonarr',
        title: job.title,
      });
    }
  }

  for (const target of deleteTargets.values()) {
    try {
      await postJson(`${config.baseUrl}/api/media/delete`, target);
    } catch {
      // Fall through to direct Arr cleanup below.
      }
  }

  await ensureSeriesMissing(config, target);
  await waitForQueueToClear(target.title, 'series', 'sonarr');
}

async function findLiveSeriesTarget(): Promise<{ title: string; year: number } | null> {
  const candidates = [
    config.untrackedSeries.title,
    'Andor',
    'Chernobyl',
    'Severance',
    'Silo',
  ];

  for (const query of candidates) {
    const results = await getJson<SearchResultItem[]>(
      `${config.baseUrl}/api/search?q=${encodeURIComponent(query)}&kind=series&availability=all`,
    ).catch(() => []);
    const candidate =
      results.find(
        (item) => item.kind === 'series' && item.canAdd && !item.inArr && item.year !== null,
      ) ?? null;
    if (candidate && candidate.year !== null) {
      return {
        title: candidate.title,
        year: candidate.year,
      };
    }
  }

  return null;
}

async function findTrackedMovieTarget(): Promise<{ title: string; year: number } | null> {
  const configuredDuplicate = await findMovieByTitleYear(config, config.duplicateMovie).catch(() => null);
  if (configuredDuplicate && configuredDuplicate.year !== null) {
    return {
      title: configuredDuplicate.title,
      year: configuredDuplicate.year,
    };
  }

  const trackedMovies = await listMovies(config);

  for (const candidate of trackedMovies) {
    if (candidate.year === null) {
      continue;
    }

    const results = await getJson<SearchResultItem[]>(
      `${config.baseUrl}/api/search?q=${encodeURIComponent(candidate.title)}&kind=movie&availability=all`,
    ).catch(() => []);
    const match =
      results.find(
        (item) =>
          item.kind === 'movie' &&
          item.inArr &&
          item.title.localeCompare(candidate.title, undefined, { sensitivity: 'accent' }) === 0 &&
          item.year === candidate.year,
      ) ?? null;

    if (match && match.year !== null) {
      return {
        title: match.title,
        year: match.year,
      };
    }
  }

  return null;
}

test.beforeAll(() => {
  assertLiveIntegrationEnabled(config);
});

test.beforeEach(async () => {
  await cleanupMovie();
  await cleanupSeries();
  if (activeSeriesTarget) {
    await cleanupSeries(activeSeriesTarget);
    activeSeriesTarget = null;
  }
});

test.afterEach(async () => {
  await cleanupMovie();
  await cleanupSeries();
  if (activeSeriesTarget) {
    await cleanupSeries(activeSeriesTarget);
    activeSeriesTarget = null;
  }
});

test('movie live UI covers search, grab, and cancel', async ({
  page,
}) => {
  test.setTimeout(240_000);

  await searchForTitle(page, config.untrackedMovie.title, 'Movies');

  const resultCard = searchResultCard(page, config.untrackedMovie.title);
  await expect(resultCard).toContainText(config.untrackedMovie.year.toString());
  await resultCard.getByRole('button', { name: 'Grab', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    `${config.untrackedMovie.title} was added to Radarr.`,
  );

  const jobCard = acquisitionJobCard(page, config.untrackedMovie.title);
  await expect(jobCard).toBeVisible();
  const job = await waitForJob(config.untrackedMovie.title, 'movie', 'radarr');
  await jobCard.getByRole('button', { name: 'Cancel download' }).click();
  await expect(page.getByText(/download was cancelled and unmonitored/i)).toBeVisible();
  await pollUntil(async () => {
    const tracked = await getMovieById(config, job.arrItemId);
    return tracked?.monitored === false ? tracked : null;
  }, 45_000);
});

test('tracked movie live UI still offers the normal grab confirmation flow', async ({ page }) => {
  test.setTimeout(120_000);

  const trackedMovie =
    (await ensureMovieTracked(config, config.duplicateMovie).catch(() => null)) ??
    (await findTrackedMovieTarget());
  test.skip(
    trackedMovie === null || trackedMovie.year === null,
    'No searchable tracked Radarr movie is currently available for alternate-grab UI verification.',
  );
  if (!trackedMovie || trackedMovie.year === null) {
    return;
  }

  await searchForTitle(page, trackedMovie.title, 'Movies');

  const resultCard = page
    .getByTestId('search-result-card')
    .filter({ has: page.getByRole('heading', { name: trackedMovie.title, exact: true }) })
    .filter({ hasText: trackedMovie.year.toString() })
    .first();
  await expect(resultCard).toBeVisible();
  await expect(resultCard).toContainText(trackedMovie.year.toString());

  const grabButton = resultCard.getByRole('button', { name: 'Grab', exact: true });
  await expect(grabButton).toBeVisible();
  await expect(grabButton).toBeEnabled();
  await grabButton.click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    /Arr is already tracking this title|Plex already has this title and Arr is already tracking it/i,
  );

  await dialog.getByLabel('Close grab confirmation').click();
  await expect(dialog).toHaveCount(0);
});

test('live UI shows actual download progress when Arr already has an active download', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const liveDownload = await findAnyLiveDownload();
  test.skip(liveDownload === null, 'No active Arr download is currently available for live UI verification.');
  if (!liveDownload) {
    return;
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'Queue' }).click();
  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();

  const downloadCard = queueItemCard(page, liveDownload.title);
  await expect(downloadCard).toBeVisible();
  await expect(downloadCard.getByText(`${Math.round(liveDownload.progress ?? 0)}%`)).toBeVisible();
  if (liveDownload.timeLeft) {
    await expect(downloadCard).toContainText(liveDownload.timeLeft);
  } else if (liveDownload.estimatedCompletionTime) {
    await expect(downloadCard).toContainText('Expected around');
  }
});

test('series live UI covers search, season selection, remove, and retry grab', async ({ page }) => {
  test.setTimeout(240_000);

  test.skip(!config.sonarrUrl || !config.sonarrApiKey, 'Sonarr live config is required.');
  const seriesTarget = await findLiveSeriesTarget();
  test.skip(seriesTarget === null, 'No searchable untracked Sonarr series target is currently available.');
  if (!seriesTarget) {
    return;
  }
  activeSeriesTarget = seriesTarget;
  await cleanupSeries(seriesTarget);

  await searchForTitle(page, seriesTarget.title, 'Shows');

  const resultCard = searchResultCard(page, seriesTarget.title);
  await expect(resultCard).toContainText(seriesTarget.year.toString());
  await resultCard.getByRole('button', { name: 'Grab', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Season / }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Grab Progress' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    `${seriesTarget.title} was added to Sonarr.`,
  );

  const jobCard = acquisitionJobCard(page, seriesTarget.title);
  await expect(jobCard).toBeVisible();

  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await jobCard.getByRole('button', { name: 'Remove from Library' }).click();
  await expect(page.getByText(/was deleted from Sonarr/i)).toBeVisible();

  await pollUntil(async () => {
    const tracked = await findSeriesByTitleYear(config, seriesTarget);
    return tracked === null ? true : null;
  }, 45_000);

  await searchForTitle(page, seriesTarget.title, 'Shows');

  const retryCard = searchResultCard(page, seriesTarget.title);
  await expect(retryCard).toBeVisible();
  await retryCard.getByRole('button', { name: 'Grab', exact: true }).click();

  const retryDialog = page.getByRole('dialog', { name: 'Grab title' });
  await expect(retryDialog).toBeVisible();
  await expect(retryDialog.getByRole('button', { name: /^Season / }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await retryDialog.getByRole('button', { name: 'Grab', exact: true }).click();

  await expect(page.getByRole('status')).toContainText(
    `${seriesTarget.title} was added to Sonarr.`,
  );
  const retryJobCard = acquisitionJobCard(page, seriesTarget.title);
  await expect(retryJobCard).toBeVisible();

  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await retryJobCard.getByRole('button', { name: 'Remove from Library' }).click();
  await expect(page.getByText(/was deleted from Sonarr/i)).toBeVisible();

  await pollUntil(async () => {
    const tracked = await findSeriesByTitleYear(config, seriesTarget);
    return tracked === null ? true : null;
  }, 45_000);
  activeSeriesTarget = null;
});
