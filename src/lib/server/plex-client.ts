import { env } from '$env/dynamic/private';

export class PlexHttpError extends Error {
  readonly path: string;
  readonly status: number;
  readonly statusText: string;

  constructor(path: string, status: number, statusText: string) {
    super(`Plex ${status}`);
    this.name = 'PlexHttpError';
    this.path = path;
    this.status = status;
    this.statusText = statusText;
  }
}

export function getPlexConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = env.PLEX_URL?.trim();
  const token = env.PLEX_TOKEN?.trim();

  if (!baseUrl || !token) {
    return null;
  }

  return {
    baseUrl,
    token,
  };
}

export async function plexFetch<T>(
  baseUrl: string,
  token: string,
  requestPath: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(requestPath, `${baseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('X-Plex-Token', token);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new PlexHttpError(requestPath, response.status, response.statusText);
  }

  return (await response.json()) as T;
}
