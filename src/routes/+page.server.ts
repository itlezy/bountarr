import { getConfigStatus } from '$lib/server/config-service';
import { getRecentPlexItems } from '$lib/server/plex-service';

export const load = async () => {
  const config = await getConfigStatus();

  return {
    config,
    recentPlex: config.plexConfigured ? await getRecentPlexItems() : [],
  };
};
