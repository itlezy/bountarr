import { json } from '@sveltejs/kit';
import { lookupItems } from '$lib/server/lookup-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import type { SearchAvailability, SearchKind } from '$lib/shared/types';

const logger = createAreaLogger('api.search');

function parseAvailability(value: string | null): SearchAvailability {
  if (value === 'all' || value === 'available-only' || value === 'not-available-only') {
    return value;
  }

  return 'not-available-only';
}

export const GET = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const kind = (url.searchParams.get('kind')?.trim() as SearchKind | null) ?? 'all';
  const availability = parseAvailability(url.searchParams.get('availability')?.trim() ?? null);

  logger.info('Search API request started', {
    query,
    kind,
    availability,
  });

  if (query.length < 2) {
    logger.info('Search API request returned early because the query is too short', {
      queryLength: query.length,
    });
    return json([]);
  }

  try {
    const result = await lookupItems(query, kind, undefined, {
      availability,
    });
    logger.info('Search API request completed', {
      query,
      kind,
      results: result.length,
    });
    return json(result);
  } catch (error) {
    logger.error('Search API request failed', {
      query,
      kind,
      ...toErrorLogContext(error),
    });
    throw error;
  }
};
