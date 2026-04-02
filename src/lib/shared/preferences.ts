import { sanitizeCardView } from '$lib/shared/card-views';
import { sanitizePreferredLanguage } from '$lib/shared/languages';
import { sanitizeTheme } from '$lib/shared/themes';
import type { Preferences } from '$lib/shared/types';

type PreferencesInput = {
  cardsView?: unknown;
  preferredLanguage?: unknown;
  subtitleLanguage?: unknown;
  theme?: unknown;
};

export const defaultPreferences: Preferences = {
  cardsView: 'rounded',
  preferredLanguage: 'English',
  subtitleLanguage: 'Any',
  theme: 'system',
};

export function sanitizePreferences(input: PreferencesInput | null | undefined): Preferences {
  const preferredLanguage = sanitizePreferredLanguage(
    input?.preferredLanguage,
    defaultPreferences.preferredLanguage,
  );
  const subtitleLanguage = sanitizePreferredLanguage(
    input?.subtitleLanguage,
    defaultPreferences.subtitleLanguage,
  );

  return {
    cardsView: sanitizeCardView(input?.cardsView, defaultPreferences.cardsView),
    preferredLanguage,
    subtitleLanguage,
    theme: sanitizeTheme(input?.theme, defaultPreferences.theme),
  };
}
