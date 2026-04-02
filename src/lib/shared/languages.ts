export const preferredAudioOptions = [
  'Any',
  'English',
  'Spanish',
  'German',
  'French',
  'Italian',
  'Japanese',
  'Portuguese',
] as const;

export const subtitleLanguageOptions = preferredAudioOptions;
export const supportedLanguageOptions = preferredAudioOptions;

export type PreferredLanguage = (typeof preferredAudioOptions)[number];

const languageAliases: Record<PreferredLanguage, string[]> = {
  Any: ['any'],
  English: ['english', 'eng', 'en'],
  Spanish: ['spanish', 'spa', 'es', 'espanol', 'español'],
  German: ['german', 'deu', 'ger', 'de'],
  French: ['french', 'fra', 'fre', 'fr'],
  Italian: ['italian', 'ita', 'it'],
  Japanese: ['japanese', 'jpn', 'ja'],
  Portuguese: ['portuguese', 'por', 'pt'],
};

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

export function sanitizePreferredLanguage(
  value: unknown,
  fallback: PreferredLanguage = 'English',
): PreferredLanguage {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = normalizeToken(value);
  if (normalized.length === 0) {
    return fallback;
  }

  for (const language of preferredAudioOptions) {
    const aliases = languageAliases[language];
    if (aliases.some((alias) => normalizeToken(alias) === normalized)) {
      return language;
    }
  }

  return fallback;
}

export function preferredLanguageMatchers(preferredLanguage: PreferredLanguage): string[] {
  if (preferredLanguage === 'Any') {
    return [];
  }

  return Array.from(
    new Set(languageAliases[preferredLanguage].map((alias) => normalizeToken(alias))),
  );
}

export function languageMatchesPreferred(
  languages: string[],
  preferredLanguage: PreferredLanguage,
): boolean {
  if (preferredLanguage === 'Any') {
    return true;
  }

  const matchers = preferredLanguageMatchers(preferredLanguage);

  return languages.map(normalizeToken).some((language) => {
    const tokens = language.split(/[\s()[\]/,._-]+/).filter((token) => token.length > 0);
    return matchers.some((matcher) => language === matcher || tokens.includes(matcher));
  });
}
