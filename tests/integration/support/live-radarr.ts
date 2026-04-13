import type { ExactMovieTarget, LiveIntegrationConfig } from './live-config';
import { pollUntil } from './live-http';

type RadarrMovieRecord = {
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

async function radarrRequest<T>(
  config: LiveIntegrationConfig,
  requestPath: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${config.radarrUrl}${requestPath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': config.radarrApiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Radarr ${requestPath} failed with ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listMovies(config: LiveIntegrationConfig): Promise<RadarrMovieRecord[]> {
  const records = await radarrRequest<Array<Record<string, unknown>>>(config, '/api/v3/movie');
  return records
    .map((record) => ({
      id: typeof record.id === 'number' ? record.id : NaN,
      monitored: typeof record.monitored === 'boolean' ? record.monitored : undefined,
      title: typeof record.title === 'string' ? record.title : '',
      year: typeof record.year === 'number' ? record.year : null,
    }))
    .filter((record) => Number.isFinite(record.id) && record.title.length > 0);
}

export async function getMovieById(
  config: LiveIntegrationConfig,
  id: number,
): Promise<RadarrMovieRecord | null> {
  try {
    const record = await radarrRequest<Record<string, unknown>>(config, `/api/v3/movie/${id}`);
    return {
      id: typeof record.id === 'number' ? record.id : NaN,
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

export async function findMovieByTitleYear(
  config: LiveIntegrationConfig,
  target: ExactMovieTarget,
): Promise<RadarrMovieRecord | null> {
  const movies = await listMovies(config);
  const normalizedTarget = normalizeTitle(target.title);

  return (
    movies.find(
      (movie) => movie.year === target.year && normalizeTitle(movie.title) === normalizedTarget,
    ) ?? null
  );
}

export async function ensureMovieTracked(
  config: LiveIntegrationConfig,
  target: ExactMovieTarget,
): Promise<RadarrMovieRecord> {
  const match = await findMovieByTitleYear(config, target);
  if (!match) {
    throw new Error(`${target.title} (${target.year}) must already be tracked in Radarr.`);
  }

  return match;
}

export async function ensureMovieMissing(
  config: LiveIntegrationConfig,
  target: ExactMovieTarget,
): Promise<void> {
  const match = await findMovieByTitleYear(config, target);
  if (!match) {
    return;
  }

  await radarrRequest(
    config,
    `/api/v3/movie/${match.id}?deleteFiles=true&addImportExclusion=false`,
    {
      method: 'DELETE',
    },
  );

  await pollUntil(
    async () => ((await findMovieByTitleYear(config, target)) === null ? true : null),
    30_000,
  );
}
