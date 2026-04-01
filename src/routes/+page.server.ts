import { getConfigStatus } from '$lib/server/arr';
import { getRecentPlexItems } from '$lib/server/plex';

export const load = async () => {
  const config = await getConfigStatus();

  return {
    config,
    recentPlex: config.plexConfigured ? await getRecentPlexItems() : []
  };
};
