import type { AuditStatus, Preferences } from '$lib/shared/types';

const languageAliases: Record<string, string[]> = {
  english: ['english', 'eng', 'en'],
  spanish: ['spanish', 'spa', 'es', 'espanol', 'español'],
  german: ['german', 'deu', 'ger', 'de'],
  french: ['french', 'fra', 'fre', 'fr'],
  italian: ['italian', 'ita', 'it'],
  japanese: ['japanese', 'jpn', 'ja'],
  portuguese: ['portuguese', 'por', 'pt']
};

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

function languageMatchers(preferredLanguage: string): string[] {
  const normalized = normalizeToken(preferredLanguage);

  return Array.from(new Set([normalized, ...(languageAliases[normalized] ?? [])]));
}

function containsLanguage(languages: string[], preferredLanguage: string): boolean {
  const normalizedLanguages = languages.map(normalizeToken);
  const matchers = languageMatchers(preferredLanguage);

  return normalizedLanguages.some((language) =>
    matchers.some((matcher) => language === matcher || language.includes(matcher))
  );
}

export function evaluateAudit(
  audioLanguages: string[],
  subtitleLanguages: string[],
  preferences: Preferences,
  hasMediaInfo: boolean
): AuditStatus {
  if (!hasMediaInfo) {
    return 'unknown';
  }

  if (!containsLanguage(audioLanguages, preferences.preferredLanguage)) {
    return 'missing-language';
  }

  if (preferences.requireSubtitles && subtitleLanguages.length === 0) {
    return 'no-subs';
  }

  return 'verified';
}
