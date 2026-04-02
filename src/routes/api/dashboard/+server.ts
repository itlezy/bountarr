import { json } from '@sveltejs/kit';
import { getDashboard } from '$lib/server/queue-dashboard-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { sanitizePreferences } from '$lib/shared/preferences';

const logger = createAreaLogger('api.dashboard');

export const GET = async ({ url }) => {
  const preferredLanguage = url.searchParams.get('preferredLanguage') ?? undefined;
  const subtitleLanguage = url.searchParams.get('subtitleLanguage') ?? undefined;
  const preferences = sanitizePreferences({
    preferredLanguage,
    subtitleLanguage,
  });

  logger.info('Dashboard API request started', {
    preferredLanguage: preferences.preferredLanguage,
    subtitleLanguage: preferences.subtitleLanguage,
  });

  try {
    const result = await getDashboard(preferences);
    logger.info('Dashboard API request completed', {
      items: result.items.length,
      attention: result.summary.attention,
    });
    return json(result);
  } catch (error) {
    logger.error('Dashboard API request failed', toErrorLogContext(error));
    throw error;
  }
};
