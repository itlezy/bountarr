import type { ExactSeriesTarget, LiveIntegrationConfig } from './live-config';
import { pollUntil } from './live-http';

type SonarrSeriesRecord = {
  id: number;
  monitored?: boolean;
  title: string;
  year: number | null;
};

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

function requireSonarr(config: LiveIntegrationConfig): { apiKey: string; url: string } {
  if (!config.sonarrApiKey || !config.sonarrUrl) {
    throw new Error('Sonarr live integration requires SONARR_URL and SONARR_API_KEY.');
  }

  return {
    apiKey: config.sonarrApiKey,
    url: config.sonarrUrl,
  };
}

async function sonarrRequest<T>(
  config: LiveIntegrationConfig,
  requestPath: string,
  init?: RequestInit,
): Promise<T> {
  const sonarr = requireSonarr(config);
  const response = await fetch(`${sonarr.url}${requestPath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': sonarr.apiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sonarr ${requestPath} failed with ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listSeries(config: LiveIntegrationConfig): Promise<SonarrSeriesRecord[]> {
  const records = await sonarrRequest<Array<Record<string, unknown>>>(config, '/api/v3/series');
  return records
    .map((record) => ({
      id: typeof record.id === 'number' ? record.id : Number.NaN,
      monitored: typeof record.monitored === 'boolean' ? record.monitored : undefined,
      title: typeof record.title === 'string' ? record.title : '',
      year: typeof record.year === 'number' ? record.year : null,
    }))
    .filter((record) => Number.isFinite(record.id) && record.title.length > 0);
}

export async function getSeriesById(
  config: LiveIntegrationConfig,
  id: number,
): Promise<SonarrSeriesRecord | null> {
  try {
    const record = await sonarrRequest<Record<string, unknown>>(config, `/api/v3/series/${id}`);
    return {
      id: typeof record.id === 'number' ? record.id : Number.NaN,
      monitored: typeof record.monitored === 'boolean' ? record.monitored : undefined,
      title: typeof record.title === 'string' ? record.title : '',
      year: typeof record.year === 'number' ? record.year : null,
    };
  } catch (error) {
    if (error instanceof Error && /\b404\b/.test(error.message)) {
      return null;
    }

    throw error;
  }
}

export async function findSeriesByTitleYear(
  config: LiveIntegrationConfig,
  target: ExactSeriesTarget,
): Promise<SonarrSeriesRecord | null> {
  const series = await listSeries(config);
  const normalizedTarget = normalizeTitle(target.title);

  return (
    series.find(
      (candidate) =>
        candidate.year === target.year && normalizeTitle(candidate.title) === normalizedTarget,
    ) ?? null
  );
}

export async function ensureSeriesMissing(
  config: LiveIntegrationConfig,
  target: ExactSeriesTarget,
): Promise<void> {
  const match = await findSeriesByTitleYear(config, target);
  if (!match) {
    return;
  }

  await sonarrRequest(
    config,
    `/api/v3/series/${match.id}?deleteFiles=true&addImportListExclusion=false`,
    {
      method: 'DELETE',
    },
  );

  await pollUntil(
    async () => ((await findSeriesByTitleYear(config, target)) === null ? true : null),
    30_000,
  );
}
