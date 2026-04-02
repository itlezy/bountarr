import { json } from '@sveltejs/kit';
import { getConfigStatus } from '$lib/server/config-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.config-status');

export const GET = async () => {
  logger.info('Config status API request started');

  try {
    const result = await getConfigStatus();
    logger.info('Config status API request completed', {
      configured: result.configured,
      radarrConfigured: result.radarrConfigured,
      sonarrConfigured: result.sonarrConfigured,
      runtimeHealthy: result.runtime.healthy,
      runtimeIssues: result.runtime.issues.length,
    });
    return json(result);
  } catch (error) {
    logger.error('Config status API request failed', toErrorLogContext(error));
    throw error;
  }
};
