import { json } from '@sveltejs/kit';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { getConfiguredServiceFlags, getRuntimeHealth } from '$lib/server/runtime';
import type { HealthResponse } from '$lib/shared/types';

const logger = createAreaLogger('api.health');

export const GET = async () => {
  logger.info('Health API request started');

  try {
    const services = getConfiguredServiceFlags();
    const runtime = getRuntimeHealth();
    const result: HealthResponse = {
      checkedAt: runtime.checkedAt,
      status: runtime.healthy ? 'ok' : 'degraded',
      configured: services.configured,
      services: {
        radarr: services.radarrConfigured,
        sonarr: services.sonarrConfigured,
        plex: services.plexConfigured,
      },
      runtime,
    };

    logger.info('Health API request completed', {
      status: result.status,
      configured: result.configured,
      issues: result.runtime.issues.length,
      warnings: result.runtime.warnings.length,
    });

    return json(result);
  } catch (error) {
    logger.error('Health API request failed', toErrorLogContext(error));
    throw error;
  }
};
