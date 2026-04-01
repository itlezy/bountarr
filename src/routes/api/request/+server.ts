import { error, json } from '@sveltejs/kit';
import { requestItem } from '$lib/server/arr';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

export const POST = async ({ request }) => {
  const payload = (await request.json()) as {
    item?: MediaItem;
    preferences?: {
      preferredLanguage?: string;
      requireSubtitles?: boolean;
      theme?: 'light' | 'dark' | 'system';
    };
  };

  if (!payload.item) {
    throw error(400, 'A media item is required.');
  }

  const result = await requestItem(payload.item, sanitizePreferences(payload.preferences));
  return json(result);
};
