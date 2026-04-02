import { asArray, asRecord, asScalarString, asString } from '$lib/server/raw';
import type { MediaItem, MediaKind } from '$lib/shared/types';

export function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function titleKey(kind: MediaKind, title: string, year: number | null): string {
  return `${kind}:${normalizeToken(title)}:${year ?? 'na'}`;
}

const arabicToRomanMap = new Map<number, string>([
  [1, 'I'],
  [2, 'II'],
  [3, 'III'],
  [4, 'IV'],
  [5, 'V'],
  [6, 'VI'],
  [7, 'VII'],
  [8, 'VIII'],
  [9, 'IX'],
  [10, 'X'],
]);

function romanTokenToNumber(token: string): number | null {
  const normalized = token.trim().toUpperCase();
  if (!/^[IVXLCDM]+$/u.test(normalized)) {
    return null;
  }

  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  let previous = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const current = values[normalized[index] ?? ''];
    if (!current) {
      return null;
    }

    if (current < previous) {
      total -= current;
    } else {
      total += current;
      previous = current;
    }
  }

  return total > 0 ? total : null;
}

function normalizeNumericTitle(value: string): string {
  return normalizeToken(value)
    .split(' ')
    .map((token) => {
      const numericValue = romanTokenToNumber(token);
      return numericValue === null ? token : String(numericValue);
    })
    .join(' ');
}

function swapStandaloneNumerals(value: string): string[] {
  const variants = new Set<string>([value.trim()]);
  const tokens = value.trim().split(/\s+/u);

  const toArabic = tokens.map((token) => {
    const numericValue = romanTokenToNumber(token);
    return numericValue === null ? token : String(numericValue);
  });
  variants.add(toArabic.join(' '));

  const toRoman = tokens.map((token) => {
    const numericValue = Number.parseInt(token, 10);
    if (Number.isNaN(numericValue)) {
      return token;
    }

    return arabicToRomanMap.get(numericValue) ?? token;
  });
  variants.add(toRoman.join(' '));

  return [...variants].filter((candidate) => candidate.trim().length > 0);
}

export function titleKeyVariants(kind: MediaKind, title: string, year: number | null): string[] {
  const keys = new Set<string>([titleKey(kind, title, year)]);
  const numericKey = `${kind}:${normalizeNumericTitle(title)}:${year ?? 'na'}`;
  keys.add(numericKey);
  return [...keys];
}

function extractMatchTitles(payload: Record<string, unknown>, fallbackTitle: string): string[] {
  const titles = new Set<string>([fallbackTitle]);
  const alternateTitles = asArray(payload.alternateTitles).map(asRecord);

  for (const candidate of [
    asString(payload.title),
    asString(payload.originalTitle),
    ...alternateTitles.map((entry) => asString(entry.title)),
  ]) {
    if (candidate) {
      titles.add(candidate);
    }
  }

  return [...titles];
}

export function itemSearchTitles(item: MediaItem): string[] {
  const payload = asRecord(item.requestPayload);
  const titles = new Set<string>();

  for (const candidate of extractMatchTitles(payload, item.title)) {
    for (const variant of swapStandaloneNumerals(candidate)) {
      titles.add(variant);
    }
  }

  return [...titles];
}

export function extractReleaser(title: string): string | null {
  const candidate = title.trim().split('-').at(-1)?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,}$/.test(candidate) ? candidate.toLowerCase() : null;
}

export function extractGuidIds(raw: Record<string, unknown>): Record<string, string> {
  const ids: Record<string, string> = {};
  const guidEntries = asArray(raw.Guid ?? raw.guids);

  for (const entry of guidEntries) {
    const record = asRecord(entry);
    const rawId = asString(record.id) ?? asString(record.guid);
    if (!rawId) {
      continue;
    }

    const match = rawId.match(/^([a-z0-9]+):\/\/(.+)$/i);
    if (!match) {
      continue;
    }

    const [, provider, providerId] = match;
    ids[provider.toLowerCase()] = providerId.trim().toLowerCase();
  }

  return ids;
}

export function itemMatchKeys(item: MediaItem): string[] {
  const payload = asRecord(item.requestPayload);
  const keys = new Set<string>();
  const pushKey = (provider: string, value: string | null) => {
    if (value) {
      keys.add(`${item.kind}:${provider}:${value.toLowerCase()}`);
    }
  };

  const guidIds = extractGuidIds(payload);
  pushKey('imdb', guidIds.imdb ?? asScalarString(payload.imdbId));
  pushKey('tmdb', guidIds.tmdb ?? asScalarString(payload.tmdbId));
  pushKey('tvdb', guidIds.tvdb ?? asScalarString(payload.tvdbId));
  pushKey('tvmaze', guidIds.tvmaze ?? asScalarString(payload.tvMazeId));

  for (const candidateTitle of itemSearchTitles(item)) {
    for (const key of titleKeyVariants(item.kind, candidateTitle, item.year)) {
      keys.add(key);
    }
  }

  return [...keys];
}
