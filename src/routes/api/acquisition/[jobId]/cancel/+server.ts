import { error, json } from '@sveltejs/kit';
import { cancelAcquisitionJob } from '$lib/server/acquisition-service';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.acquisition.cancel');

export const POST = async ({ params }: { params: { jobId: string } }) => {
  logger.info('Acquisition cancel request started', {
    jobId: params.jobId,
  });

  try {
    const result = await cancelAcquisitionJob(params.jobId);
    logger.info('Acquisition cancel request completed', {
      jobId: params.jobId,
      status: result.job.status,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to cancel the selected download.');
    logger.error('Acquisition cancel request failed', {
      jobId: params.jobId,
      ...toErrorLogContext(requestError),
    });

    throw error(message.includes('was not found') ? 404 : 500, message);
  }
};
