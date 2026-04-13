import { json } from '@sveltejs/kit';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { resolveGrabCandidateFromPlexItem } from '$lib/server/lookup-service';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { ThemeMode } from '$lib/shared/themes';
import type { MediaItem } from '$lib/shared/types';

const logger = createAreaLogger('api.grab.resolve');

export const POST = async ({ request }) => {
  const payload = (await request.json()) as {
    item?: MediaItem;
    preferences?: {
      preferredLanguage?: string;
      subtitleLanguage?: string;
      theme?: ThemeMode;
    };
  };

  if (!payload.item) {
    return json(null);
  }

  const preferences = sanitizePreferences(payload.preferences);

  logger.info('Grab resolve API call started', {
    kind: payload.item.kind,
    sourceService: payload.item.sourceService,
    title: payload.item.title,
  });

  try {
    const resolved = await resolveGrabCandidateFromPlexItem(payload.item, preferences);
    logger.info('Grab resolve API call completed', {
      resolved: resolved !== null,
      title: payload.item.title,
    });
    return json(resolved);
  } catch (error) {
    logger.error('Grab resolve API call failed', {
      title: payload.item.title,
      ...toErrorLogContext(error),
    });
    return json(null);
  }
};
