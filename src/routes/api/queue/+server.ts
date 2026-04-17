import { json } from '@sveltejs/kit';
import { getQueue } from '$lib/server/queue-dashboard-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.queue');

export const GET = async () => {
  logger.info('Queue API request started');

  try {
    const result = await getQueue();
    logger.info('Queue API request completed', {
      entries: result.entries.length,
      managedEntries: result.entries.filter((entry) => entry.kind === 'managed').length,
      externalEntries: result.entries.filter((entry) => entry.kind === 'external').length,
      total: result.total,
    });
    return json(result);
  } catch (error) {
    logger.error('Queue API request failed', toErrorLogContext(error));
    throw error;
  }
};
