import { error, json } from '@sveltejs/kit';
import { requestItem } from '$lib/server/arr';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

export const POST = async ({ request }) => {
  const payload = (await request.json()) as {
    item?: MediaItem;
    qualityProfileId?: number;
    preferences?: {
      preferredLanguage?: string;
      requireSubtitles?: boolean;
      theme?: 'light' | 'dark' | 'system';
    };
  };

  if (!payload.item) {
    throw error(400, 'A media item is required.');
  }

  try {
    const result = await requestItem(payload.item, sanitizePreferences(payload.preferences), {
      qualityProfileId:
        typeof payload.qualityProfileId === 'number' && Number.isFinite(payload.qualityProfileId)
          ? payload.qualityProfileId
          : undefined
    });
    return json(result);
  } catch (requestError) {
    const message =
      requestError instanceof Error ? requestError.message : 'Unable to add the selected item.';

    return new Response(message, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }
};
