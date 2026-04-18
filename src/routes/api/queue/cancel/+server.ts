import { error, json } from '@sveltejs/kit';
import { cancelQueueEntry } from '$lib/server/acquisition-service';
import { asArray, asNumber, asRecord, asString } from '$lib/server/raw';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import type { QueueCancelRequest } from '$lib/shared/types';

const logger = createAreaLogger('api.queue.cancel');

function queueCancelTargetId(target: QueueCancelRequest): string {
  return target.kind === 'managed' ? target.jobId : target.id;
}

function queueCancelTargetQueueId(target: QueueCancelRequest): number | null {
  return target.kind === 'external' ? target.queueId : null;
}

function queueCancelTargetService(target: QueueCancelRequest): 'radarr' | 'sonarr' | null {
  return target.kind === 'external' ? target.sourceService : null;
}

export const POST = async ({ request }: { request: Request }) => {
  const payload = asRecord(await request.json());
  const kind = asString(payload.kind);

  const queueId =
    payload.queueId === null || payload.queueId === undefined
      ? payload.queueId
      : asNumber(payload.queueId);
  const downloadId = asString(payload.downloadId);
  const arrItemId =
    payload.arrItemId === null || payload.arrItemId === undefined
      ? payload.arrItemId
      : asNumber(payload.arrItemId);
  let cancelTarget: QueueCancelRequest | null = null;

  if (kind === 'managed') {
    const jobId = asString(payload.jobId);
    if (!jobId) {
      throw error(400, 'A cancelable managed queue entry is required.');
    }

    cancelTarget = {
      kind: 'managed',
      jobId,
    };
  } else if (kind === 'external') {
    const id = asString(payload.id);
    const sourceService =
      payload.sourceService === 'radarr' || payload.sourceService === 'sonarr'
        ? payload.sourceService
        : null;
    const title = asString(payload.title);

    if (
      !id ||
      (queueId === null || queueId === undefined) && !downloadId ||
      !sourceService ||
      !title
    ) {
      throw error(400, 'A cancelable external queue entry is required.');
    }

    cancelTarget = {
      kind: 'external',
      id,
      arrItemId: arrItemId ?? null,
      queueId: queueId ?? null,
      downloadId: downloadId ?? null,
      sourceService,
      title,
    };
  } else {
    throw error(400, 'A cancelable queue entry is required.');
  }

  const target = cancelTarget;

  logger.info('Queue cancel request started', {
    itemId: queueCancelTargetId(target),
    kind: target.kind,
    queueId: queueCancelTargetQueueId(target),
    service: queueCancelTargetService(target),
  });

  try {
    const result = await cancelQueueEntry(target);
    logger.info('Queue cancel request completed', {
      itemId: queueCancelTargetId(target),
      kind: target.kind,
      queueId: queueCancelTargetQueueId(target),
      service: queueCancelTargetService(target),
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to cancel the selected download.');
    const status =
      message.includes('was not found')
        ? 404
        : message.includes('no longer current') ||
            message.includes('no longer actively downloading') ||
            message.includes('cannot be cancelled')
          ? 409
          : 500;
    logger.error('Queue cancel request failed', {
      itemId: queueCancelTargetId(target),
      kind: target.kind,
      queueId: queueCancelTargetQueueId(target),
      service: queueCancelTargetService(target),
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
