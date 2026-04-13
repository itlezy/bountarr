import { configStatusFixture } from '$lib/server/api-test-fixtures';
import type { ConfigStatus, MediaItem } from '$lib/shared/types';

export const uiTestConfigFixture: ConfigStatus = {
  ...configStatusFixture,
  plexConfigured: false,
  plexStats: {
    libraryCount: 0,
    movieLibraryCount: 0,
    showLibraryCount: 0,
    libraryTitles: [],
  },
};

export const uiTestRecentPlexFixture: MediaItem[] = [];
