import { languageMatchesPreferred } from '$lib/shared/languages';
import type { AuditStatus, Preferences } from '$lib/shared/types';

export function evaluateAudit(
  audioLanguages: string[],
  subtitleLanguages: string[],
  preferences: Preferences,
  hasMediaInfo: boolean,
): AuditStatus {
  if (!hasMediaInfo) {
    return 'unknown';
  }

  if (!languageMatchesPreferred(audioLanguages, preferences.preferredLanguage)) {
    return 'missing-language';
  }

  if (
    preferences.subtitleLanguage !== 'Any' &&
    !languageMatchesPreferred(subtitleLanguages, preferences.subtitleLanguage)
  ) {
    return 'no-subs';
  }

  return 'verified';
}
