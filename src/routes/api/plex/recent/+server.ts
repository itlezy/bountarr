import { json } from '@sveltejs/kit';
import { getRecentPlexItems } from '$lib/server/plex-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.plex-recent');

export const GET = async () => {
  logger.info('Plex recent API request started');

  try {
    const result = await getRecentPlexItems();
    logger.info('Plex recent API request completed', {
      items: result.length,
    });
    return json(result);
  } catch (error) {
    logger.error('Plex recent API request failed', toErrorLogContext(error));
    throw error;
  }
};
