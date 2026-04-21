import { json } from '@sveltejs/kit';
import { readJsonRecord } from '$lib/server/api-request';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { resolveGrabCandidateFromPlexItem } from '$lib/server/lookup-service';
import { asRecord } from '$lib/server/raw';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

const logger = createAreaLogger('api.grab.resolve');

export const POST = async ({ request }) => {
  const payload = await readJsonRecord(request);
  const item = asRecord(payload.item) as Partial<MediaItem>;

  if (!item.id || !item.title || !item.kind) {
    return json(null);
  }

  const preferences = sanitizePreferences(asRecord(payload.preferences));

  logger.info('Grab resolve API call started', {
    kind: item.kind,
    sourceService: item.sourceService,
    title: item.title,
  });

  try {
    const resolved = await resolveGrabCandidateFromPlexItem(item as MediaItem, preferences);
    logger.info('Grab resolve API call completed', {
      resolved: resolved !== null,
      title: item.title,
    });
    return json(resolved);
  } catch (error) {
    logger.error('Grab resolve API call failed', {
      title: item.title,
      ...toErrorLogContext(error),
    });
    return json(null);
  }
};
