import { json } from '@sveltejs/kit';
import { getDashboard } from '$lib/server/arr';
import { sanitizePreferences } from '$lib/shared/preferences';

export const POST = async ({ request }) => {
  const payload = (await request.json()) as {
    preferredLanguage?: string;
    requireSubtitles?: boolean;
    theme?: 'system' | 'light' | 'dark';
  };

  return json(await getDashboard(sanitizePreferences(payload), { force: true }));
};
