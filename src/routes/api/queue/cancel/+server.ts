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

function sanitizeNumberArray(value: unknown): number[] | null {
  const normalized = [...new Set(
    asArray(value)
      .map((entry) => asNumber(entry))
      .filter((entry): entry is number => entry !== null)
      .map((entry) => Math.trunc(entry))
      .filter((entry) => entry >= 0),
  )].sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : null;
}

export const POST = async ({ request }: { request: Request }) => {
  const payload = asRecord(await request.json());
  const kind = asString(payload.kind);

  const queueId =
    payload.queueId === null || payload.queueId === undefined
      ? payload.queueId
      : asNumber(payload.queueId);
  const arrItemId =
    payload.arrItemId === null || payload.arrItemId === undefined
      ? payload.arrItemId
      : asNumber(payload.arrItemId);
  let cancelTarget: QueueCancelRequest | null = null;

  if (kind === 'managed') {
    const jobId = asString(payload.jobId);
    const currentRelease =
      payload.currentRelease === null || payload.currentRelease === undefined
        ? null
        : asString(payload.currentRelease);
    const sourceService =
      payload.sourceService === 'radarr' || payload.sourceService === 'sonarr'
        ? payload.sourceService
        : null;
    const targetEpisodeIds = sanitizeNumberArray(payload.targetEpisodeIds);
    const targetSeasonNumbers = sanitizeNumberArray(payload.targetSeasonNumbers);
    const title = asString(payload.title);

    if (
      !jobId ||
      arrItemId === null ||
      arrItemId === undefined ||
      !sourceService ||
      !title
    ) {
      throw error(400, 'A cancelable managed queue entry is required.');
    }

    cancelTarget = {
      kind: 'managed',
      jobId,
      arrItemId,
      currentRelease,
      sourceService,
      targetEpisodeIds,
      targetSeasonNumbers,
      title,
    };
  } else if (kind === 'external') {
    const id = asString(payload.id);
    const sourceService =
      payload.sourceService === 'radarr' || payload.sourceService === 'sonarr'
        ? payload.sourceService
        : null;
    const title = asString(payload.title);

    if (!id || queueId === null || queueId === undefined || !sourceService || !title) {
      throw error(400, 'A cancelable external queue entry is required.');
    }

    cancelTarget = {
      kind: 'external',
      id,
      arrItemId: arrItemId ?? null,
      queueId,
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
    service: target.sourceService,
  });

  try {
    const result = await cancelQueueEntry(target);
    logger.info('Queue cancel request completed', {
      itemId: queueCancelTargetId(target),
      kind: target.kind,
      queueId: queueCancelTargetQueueId(target),
      service: target.sourceService,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to cancel the selected download.');
    logger.error('Queue cancel request failed', {
      itemId: queueCancelTargetId(target),
      kind: target.kind,
      queueId: queueCancelTargetQueueId(target),
      service: target.sourceService,
      ...toErrorLogContext(requestError),
    });

    return new Response(message, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
};
