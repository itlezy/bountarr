import { error, json } from '@sveltejs/kit';
import { deleteArrItem } from '$lib/server/acquisition-service';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import { asNumber, asString } from '$lib/server/raw';
import type { ArrDeleteTarget, MediaItem } from '$lib/shared/types';

const logger = createAreaLogger('api.media.delete');

export const POST = async ({ request }: { request: Request }) => {
  const payload = (await request.json()) as {
    arrItemId?: number | null;
    id?: string;
    kind?: MediaItem['kind'];
    queueId?: number | null;
    sourceService?: MediaItem['sourceService'];
    title?: string;
  };

  const item = {
    arrItemId:
      payload.arrItemId === null || payload.arrItemId === undefined
        ? null
        : (asNumber(payload.arrItemId) ?? null),
    id: asString(payload.id),
    kind: payload.kind,
    queueId:
      payload.queueId === null || payload.queueId === undefined
        ? null
        : (asNumber(payload.queueId) ?? null),
    sourceService: payload.sourceService,
    title: asString(payload.title),
  };

  if (
    !item.id ||
    (item.arrItemId === null && item.queueId === null) ||
    !item.kind ||
    !item.sourceService ||
    !item.title
  ) {
    throw error(400, 'A deletable Arr item is required.');
  }

  if (item.sourceService !== 'radarr' && item.sourceService !== 'sonarr') {
    throw error(400, 'Only Radarr or Sonarr items can be deleted.');
  }

  const deletableItem = {
    arrItemId: item.arrItemId,
    id: item.id,
    kind: item.kind,
    queueId: item.queueId,
    sourceService: item.sourceService,
    title: item.title,
  } satisfies ArrDeleteTarget;

  logger.info('Media delete request started', {
    arrItemId: item.arrItemId,
    itemId: item.id,
    kind: item.kind,
    service: item.sourceService,
  });

  try {
    const result = await deleteArrItem(deletableItem);
    logger.info('Media delete request completed', {
      arrItemId: item.arrItemId,
      itemId: item.id,
      kind: item.kind,
      service: item.sourceService,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to delete the selected Arr item.');
    logger.error('Media delete request failed', {
      arrItemId: item.arrItemId,
      itemId: item.id,
      kind: item.kind,
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
