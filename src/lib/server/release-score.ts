import type {
  Preferences,
  ReleaseDecision,
  ReleaseDecisionCandidate
} from '$lib/shared/types';

type ReleaseSelection = {
  decision: ReleaseDecision;
  payload: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

function parseLanguages(value: unknown): string[] {
  const languages = new Set<string>();

  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const candidate =
      asString(record.name) ??
      asString(record.displayName) ??
      asString(record.value) ??
      asString(entry);

    if (candidate) {
      languages.add(candidate);
    }
  }

  return [...languages];
}

function containsPreferredLanguage(languages: string[], preferredLanguage: string): boolean {
  const preferred = normalizeToken(preferredLanguage);
  if (preferred.length === 0) {
    return true;
  }

  return languages.some((language) => {
    const normalized = normalizeToken(language);
    return normalized === preferred || normalized.includes(preferred) || preferred.includes(normalized);
  });
}

function titleSignals(title: string, preferences: Preferences) {
  const normalized = normalizeToken(title);

  return {
    subtitleHint:
      preferences.requireSubtitles &&
      /(sub|subs|subbed|multisub|multi sub|multi-sub|vostfr|softsub)/.test(normalized),
    multiLanguageHint: /(multi|dual audio|dual-audio)/.test(normalized),
    badQualityHint: /(cam|telesync|telecine|workprint|hdts|ts\b|tc\b)/.test(normalized)
  };
}

function rejectionReason(release: Record<string, unknown>): string | null {
  if (release.downloadAllowed !== true) {
    return 'Arr marked this release as not downloadable';
  }

  if (release.rejected === true) {
    const firstRejection = asString(asArray(release.rejections)[0]);
    return firstRejection ?? 'Arr rejected this release';
  }

  return null;
}

function buildCandidate(
  release: Record<string, unknown>,
  preferences: Preferences
): { candidate: ReleaseDecisionCandidate; payload: Record<string, unknown> } | null {
  const guid = asString(release.guid);
  const indexerId = asNumber(release.indexerId);
  const title = asString(release.title);

  if (!guid || !indexerId || !title) {
    return null;
  }

  const rejection = rejectionReason(release);
  const languages = parseLanguages(release.languages);
  const signals = titleSignals(title, preferences);
  const preferredLanguageMatch = containsPreferredLanguage(languages, preferences.preferredLanguage);

  let score =
    (asNumber(release.qualityWeight) ?? 0) +
    (asNumber(release.releaseWeight) ?? 0) +
    (asNumber(release.customFormatScore) ?? 0) * 5;

  const reasons: string[] = [];

  if (preferredLanguageMatch) {
    score += 120;
    reasons.push(`preferred audio ${preferences.preferredLanguage}`);
  } else if (languages.length > 0) {
    score -= 80;
    reasons.push(`language mismatch (${languages.join(', ')})`);
  }

  if (signals.multiLanguageHint) {
    score += 18;
    reasons.push('multi-language release');
  }

  if (signals.subtitleHint) {
    score += 16;
    reasons.push('subtitle hint in title');
  } else if (preferences.requireSubtitles) {
    reasons.push('no subtitle hint');
  }

  if (signals.badQualityHint) {
    score -= 200;
    reasons.push('low-quality source hint');
  }

  const protocol = asString(release.protocol) ?? 'unknown';
  if (protocol.toLowerCase() === 'usenet') {
    score += 4;
  }

  if (rejection) {
    score -= 1_000;
    reasons.push(rejection);
  }

  return {
    candidate: {
      title,
      guid,
      indexer: asString(release.indexer) ?? 'Unknown',
      indexerId,
      protocol,
      size: asNumber(release.size) ?? 0,
      languages,
      score,
      reason: reasons.join('; ') || 'Arr score only'
    },
    payload: release
  };
}

export function selectBestRelease(
  rawReleases: unknown[],
  preferences: Preferences
): ReleaseSelection {
  const evaluated = rawReleases
    .map((entry) => buildCandidate(asRecord(entry), preferences))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const accepted = evaluated.filter((entry) => entry.candidate.score > -900);
  const ordered = [...accepted].sort((left, right) => {
    if (left.candidate.score !== right.candidate.score) {
      return right.candidate.score - left.candidate.score;
    }

    if (left.candidate.size !== right.candidate.size) {
      return right.candidate.size - left.candidate.size;
    }

    return left.candidate.title.localeCompare(right.candidate.title);
  });

  const selected = ordered[0] ?? null;

  if (!selected) {
    return {
      payload: null,
      decision: {
        considered: rawReleases.length,
        accepted: accepted.length,
        selected: null,
        reason:
          rawReleases.length === 0
            ? 'No manual-search releases were returned by Arr'
            : 'No acceptable release passed the local scoring rules'
      }
    };
  }

  return {
    payload: selected.payload,
    decision: {
      considered: rawReleases.length,
      accepted: accepted.length,
      selected: selected.candidate,
      reason: `Picked ${selected.candidate.title}: ${selected.candidate.reason}`
    }
  };
}
