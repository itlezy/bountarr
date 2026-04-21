import { json } from '@sveltejs/kit';
import { readJsonRecord } from '$lib/server/api-request';
import { getDashboard } from '$lib/server/queue-dashboard-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { sanitizePreferences } from '$lib/shared/preferences';

const logger = createAreaLogger('api.dashboard-refresh');

export const POST = async ({ request }) => {
  const payload = await readJsonRecord(request);
  const preferences = sanitizePreferences(payload);

  logger.info('Dashboard refresh API request started', {
    preferredLanguage: preferences.preferredLanguage,
    subtitleLanguage: preferences.subtitleLanguage,
  });

  try {
    const result = await getDashboard(preferences, { force: true });
    logger.info('Dashboard refresh API request completed', {
      items: result.items.length,
      attention: result.summary.attention,
    });
    return json(result);
  } catch (error) {
    logger.error('Dashboard refresh API request failed', toErrorLogContext(error));
    throw error;
  }
};
