import { error, json } from '@sveltejs/kit';
import { selectManualRelease } from '$lib/server/acquisition-service';
import { asNumber, asString } from '$lib/server/raw';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import type { ManualReleaseSelectRequest, ManualReleaseSelectionMode } from '$lib/shared/types';

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
  const payload = (await request.json()) as Partial<ManualReleaseSelectRequest>;
  const guid = asString(payload.guid);
  const indexerId = asNumber(payload.indexerId);
  const selectionMode =
    payload.selectionMode === 'direct' || payload.selectionMode === 'override-arr-rejection'
      ? (payload.selectionMode as ManualReleaseSelectionMode)
      : null;

  if (!guid || indexerId === null || selectionMode === null) {
    throw error(400, 'A release guid, indexer id, and selection mode are required.');
  }

  logger.info('Acquisition manual-select request started', {
    guid,
    indexerId,
    jobId: params.jobId,
    selectionMode,
  });

  try {
    const result = await selectManualRelease(
      params.jobId,
      guid,
      indexerId,
      selectionMode,
    );
    logger.info('Acquisition manual-select request completed', {
      guid,
      indexerId,
      jobId: params.jobId,
      selectionMode,
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
      selectionMode,
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
