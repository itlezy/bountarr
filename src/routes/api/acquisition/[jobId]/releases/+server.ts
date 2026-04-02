import { error, json } from '@sveltejs/kit';
import { getManualReleaseResults } from '$lib/server/acquisition-service';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.acquisition.releases');

export const GET = async ({ params }: { params: { jobId: string } }) => {
  logger.info('Acquisition manual-results request started', {
    jobId: params.jobId,
  });

  try {
    const result = await getManualReleaseResults(params.jobId);
    logger.info('Acquisition manual-results request completed', {
      jobId: params.jobId,
      releases: result.releases.length,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to load manual-search releases.');
    logger.error('Acquisition manual-results request failed', {
      jobId: params.jobId,
      ...toErrorLogContext(requestError),
    });

    throw error(message.includes('was not found') ? 404 : 500, message);
  }
};
