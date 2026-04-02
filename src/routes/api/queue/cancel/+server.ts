import { error, json } from '@sveltejs/kit';
import { cancelQueueItem } from '$lib/server/acquisition-service';
import { asNumber, asString } from '$lib/server/raw';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import type { QueueItem } from '$lib/shared/types';

const logger = createAreaLogger('api.queue.cancel');

export const POST = async ({ request }: { request: Request }) => {
  const payload = (await request.json()) as {
    arrItemId?: number | null;
    canCancel?: boolean;
    id?: string;
    kind?: QueueItem['kind'];
    queueId?: number | null;
    sourceService?: QueueItem['sourceService'];
    title?: string;
  };

  const queueId =
    payload.queueId === null || payload.queueId === undefined
      ? payload.queueId
      : asNumber(payload.queueId);
  const arrItemId =
    payload.arrItemId === null || payload.arrItemId === undefined
      ? payload.arrItemId
      : asNumber(payload.arrItemId);
  const item = {
    arrItemId: arrItemId ?? null,
    canCancel: payload.canCancel === true,
    id: asString(payload.id),
    kind: payload.kind,
    queueId: queueId ?? null,
    sourceService: payload.sourceService,
    title: asString(payload.title),
  };

  if (!item.id || !item.kind || item.queueId === undefined || !item.sourceService || !item.title) {
    throw error(400, 'A cancelable queue item is required.');
  }

  const cancelableItem = {
    ...item,
    id: item.id,
    kind: item.kind,
    queueId: item.queueId,
    sourceService: item.sourceService,
    title: item.title,
  } satisfies Pick<
    QueueItem,
    'arrItemId' | 'canCancel' | 'id' | 'kind' | 'queueId' | 'sourceService' | 'title'
  >;

  logger.info('Queue cancel request started', {
    itemId: item.id,
    queueId: item.queueId,
    service: item.sourceService,
  });

  try {
    const result = await cancelQueueItem(cancelableItem);
    logger.info('Queue cancel request completed', {
      itemId: item.id,
      queueId: item.queueId,
      service: item.sourceService,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to cancel the selected download.');
    logger.error('Queue cancel request failed', {
      itemId: item.id,
      queueId: item.queueId,
      service: item.sourceService,
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
