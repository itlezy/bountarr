import { error, json } from '@sveltejs/kit';
import { readJsonRecord } from '$lib/server/api-request';
import { deleteArrItem } from '$lib/server/acquisition-service';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import { asNumber, asString } from '$lib/server/raw';
import type { ArrDeleteTarget, MediaKind } from '$lib/shared/types';

const logger = createAreaLogger('api.media.delete');

function asMediaKind(value: unknown): MediaKind | null {
  return value === 'movie' || value === 'series' ? value : null;
}

function asDeleteSourceService(value: unknown): ArrDeleteTarget['sourceService'] | null {
  return value === 'radarr' || value === 'sonarr' ? value : null;
}

export const POST = async ({ request }: { request: Request }) => {
  const payload = await readJsonRecord(request);

  const baseItem = {
    deleteMode:
      payload.deleteMode === 'library' || payload.deleteMode === 'queue-entry'
        ? payload.deleteMode
        : null,
    id: asString(payload.id),
    kind: asMediaKind(payload.kind),
    sourceService: asDeleteSourceService(payload.sourceService),
    title: asString(payload.title),
  };

  if (!baseItem.id || !baseItem.kind || !baseItem.sourceService || !baseItem.title) {
    throw error(400, 'A deletable target is required.');
  }

  if (baseItem.sourceService !== 'radarr' && baseItem.sourceService !== 'sonarr') {
    throw error(400, 'Only Radarr or Sonarr items can be deleted.');
  }

  let deletableItem: ArrDeleteTarget;
  if (payload.deleteMode === 'library') {
    const arrItemId =
      payload.arrItemId === null || payload.arrItemId === undefined
        ? null
        : (asNumber(payload.arrItemId) ?? null);
    if (arrItemId === null) {
      throw error(400, 'A library delete requires a tracked Arr item.');
    }

    deletableItem = {
      deleteMode: 'library',
      arrItemId,
      id: baseItem.id,
      kind: baseItem.kind,
      sourceService: baseItem.sourceService,
      title: baseItem.title,
    };
  } else if (payload.deleteMode === 'queue-entry') {
    const queueId =
      payload.queueId === null || payload.queueId === undefined
        ? null
        : (asNumber(payload.queueId) ?? null);
    const downloadId = asString(payload.downloadId);
    if (queueId === null && !downloadId) {
      throw error(400, 'A queue-entry delete requires a queue row id or download id.');
    }

    deletableItem = {
      deleteMode: 'queue-entry',
      id: baseItem.id,
      kind: baseItem.kind,
      queueId,
      downloadId: downloadId ?? null,
      sourceService: baseItem.sourceService,
      title: baseItem.title,
    };
  } else {
    throw error(400, 'A delete mode is required.');
  }

  logger.info('Media delete request started', {
    deleteMode: deletableItem.deleteMode,
    itemId: deletableItem.id,
    kind: deletableItem.kind,
    service: deletableItem.sourceService,
  });

  try {
    const result = await deleteArrItem(deletableItem);
    logger.info('Media delete request completed', {
      deleteMode: deletableItem.deleteMode,
      itemId: deletableItem.id,
      kind: deletableItem.kind,
      service: deletableItem.sourceService,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to delete the selected Arr item.');
    const status = message.includes('was not found')
      ? 404
      : message.includes('no longer current') ||
          message.includes('still active') ||
          message.includes('did not expose a queue id')
        ? 409
        : 500;
    logger.error('Media delete request failed', {
      deleteMode: deletableItem.deleteMode,
      itemId: deletableItem.id,
      kind: deletableItem.kind,
      service: deletableItem.sourceService,
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
