import type { Preferences } from '$lib/shared/types';

export const defaultPreferences: Preferences = {
  preferredLanguage: 'English',
  requireSubtitles: true,
  theme: 'system'
};

export function sanitizePreferences(input: Partial<Preferences> | null | undefined): Preferences {
  const preferredLanguage =
    typeof input?.preferredLanguage === 'string' && input.preferredLanguage.trim().length > 0
      ? input.preferredLanguage.trim()
      : defaultPreferences.preferredLanguage;

  const requireSubtitles =
    typeof input?.requireSubtitles === 'boolean'
      ? input.requireSubtitles
      : defaultPreferences.requireSubtitles;

  const theme =
    input?.theme === 'light' || input?.theme === 'dark' || input?.theme === 'system'
      ? input.theme
      : defaultPreferences.theme;

  return {
    preferredLanguage,
    requireSubtitles,
    theme
  };
}
