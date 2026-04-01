import { json } from '@sveltejs/kit';
import { getDashboard } from '$lib/server/arr';
import { sanitizePreferences } from '$lib/shared/preferences';

export const GET = async ({ url }) => {
  const preferredLanguage = url.searchParams.get('preferredLanguage') ?? undefined;
  const requireSubtitles = url.searchParams.get('requireSubtitles');

  return json(
    await getDashboard(
      sanitizePreferences({
        preferredLanguage,
        requireSubtitles: requireSubtitles === null ? undefined : requireSubtitles === 'true'
      })
    )
  );
};
