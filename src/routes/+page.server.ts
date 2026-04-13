import { env } from '$env/dynamic/private';
import { getConfigStatus } from '$lib/server/config-service';
import { getRecentPlexItems } from '$lib/server/plex-service';
import { uiTestConfigFixture, uiTestRecentPlexFixture } from '$lib/server/ui-test-fixtures';

export const load = async () => {
  if (env.BOUNTARR_UI_TEST_MODE === '1') {
    return {
      config: uiTestConfigFixture,
      recentPlex: uiTestRecentPlexFixture,
    };
  }

  const config = await getConfigStatus();

  return {
    config,
    recentPlex: config.plexConfigured ? await getRecentPlexItems() : [],
  };
};
