import { json } from '@sveltejs/kit';
import { getAcquisitionJobs } from '$lib/server/acquisition-service';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.acquisition');

export const GET = async () => {
  logger.info('Acquisition API request started');

  try {
    const result = await getAcquisitionJobs();
    logger.info('Acquisition API request completed', {
      jobs: result.jobs.length,
    });
    return json(result);
  } catch (error) {
    logger.error('Acquisition API request failed', toErrorLogContext(error));
    throw error;
  }
};
