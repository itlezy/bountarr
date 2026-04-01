import { json } from '@sveltejs/kit';
import { lookupItems } from '$lib/server/arr';
import type { SearchKind } from '$lib/shared/types';

export const GET = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const kind = (url.searchParams.get('kind')?.trim() as SearchKind | null) ?? 'all';
  const includeAvailable = url.searchParams.get('includeAvailable');

  if (query.length < 2) {
    return json([]);
  }

  return json(
    await lookupItems(query, kind, undefined, {
      includeAvailable: includeAvailable === null ? true : includeAvailable === 'true'
    })
  );
};
