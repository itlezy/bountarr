import { json } from '@sveltejs/kit';
import { getRecentPlexItems } from '$lib/server/plex';

export const GET = async () => {
  return json(await getRecentPlexItems());
};
