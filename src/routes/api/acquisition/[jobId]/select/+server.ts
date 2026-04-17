import { error, json } from '@sveltejs/kit';
import { selectManualRelease } from '$lib/server/acquisition-service';
import { asNumber, asString } from '$lib/server/raw';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';

const logger = createAreaLogger('api.acquisition.select');

function isManualReleaseConflict(message: string): boolean {
  return (
    message.includes('can no longer accept manual release selections') ||
    message.includes('already has a queued manual release selection')
  );
}

export const POST = async ({
  params,
  request,
}: {
  params: { jobId: string };
  request: Request;
}) => {
  const payload = (await request.json()) as {
    guid?: string;
    indexerId?: number;
  };
  const guid = asString(payload.guid);
  const indexerId = asNumber(payload.indexerId);

  if (!guid || indexerId === null) {
    throw error(400, 'A release guid and indexer id are required.');
  }

  logger.info('Acquisition manual-select request started', {
    guid,
    indexerId,
    jobId: params.jobId,
  });

  try {
    const result = await selectManualRelease(params.jobId, guid, indexerId);
    logger.info('Acquisition manual-select request completed', {
      guid,
      indexerId,
      jobId: params.jobId,
      status: result.job.status,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to select the requested release.');
    const status =
      message.includes('was not found') || message.includes('no longer available')
        ? 404
        : isManualReleaseConflict(message)
          ? 409
          : 500;
    logger.error('Acquisition manual-select request failed', {
      guid,
      indexerId,
      jobId: params.jobId,
      ...toErrorLogContext(requestError),
    });

    return new Response(message, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
};
