import type {
  Preferences,
  ReleaseDecision,
  ReleaseDecisionCandidate
} from '$lib/shared/types';

type ReleaseSelection = {
  decision: ReleaseDecision;
  payload: Record<string, unknown> | null;
};

type ReleaseSelectionOptions = {
  kind: 'movie' | 'series';
  preferredReleaser?: string | null;
};

const preferredReleasers = ['flux', 'ntb', 'framestor'];
const hardRejectPatterns = [/\byts\b/i, /\bpsa\b/i, /\bcam\b/i, /(^|[\s.-])ts($|[\s.-])/i];
const sourceWeights: Array<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /\bweb[\s.-]?dl\b/i, score: 120, label: 'WEB-DL' },
  { pattern: /\bwebrip\b/i, score: 80, label: 'WEBRip' },
  { pattern: /\bblu[\s.-]?ray\b/i, score: 40, label: 'BluRay' }
];

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

function splitWords(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
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
    x265Hint: /\bx265\b|\bhevc\b/i.test(title),
    sourceMatch: sourceWeights.find((entry) => entry.pattern.test(title)) ?? null
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

function extractReleaser(title: string): string | null {
  const trimmed = title.trim();
  const match = trimmed.match(/-([A-Za-z0-9][A-Za-z0-9._-]{1,})$/);
  return match ? match[1].toLowerCase() : null;
}

function includesEnglish(languages: string[], title: string): boolean {
  if (containsPreferredLanguage(languages, 'English')) {
    return true;
  }

  return /\beng\b|\benglish\b/i.test(title);
}

function buildCandidate(
  release: Record<string, unknown>,
  preferences: Preferences,
  options: ReleaseSelectionOptions
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
  const releaser = extractReleaser(title);
  const isMultiAudio = signals.multiLanguageHint || /\bmulti\b|\bdual[ .-]?audio\b/i.test(title);
  const hasEnglish = includesEnglish(languages, title);

  let score =
    (asNumber(release.qualityWeight) ?? 0) +
    (asNumber(release.releaseWeight) ?? 0) +
    (asNumber(release.customFormatScore) ?? 0) * 5;

  const reasons: string[] = [];

  if (rejection) {
    score = -10_000;
    reasons.push(rejection);
  }

  if (hardRejectPatterns.some((pattern) => pattern.test(title))) {
    score = -10_000;
    reasons.push('blocked releaser or source pattern');
  }

  if (!hasEnglish || (!preferredLanguageMatch && !isMultiAudio)) {
    score = -10_000;
    reasons.push('missing English audio');
  }

  if (preferredLanguageMatch) {
    score += 120;
    reasons.push(`preferred audio ${preferences.preferredLanguage}`);
  }

  if (signals.multiLanguageHint) {
    score += 18;
    reasons.push('multi-language release');
  }

  if (signals.sourceMatch) {
    score += signals.sourceMatch.score;
    reasons.push(`${signals.sourceMatch.label} source`);
  }

  if (signals.x265Hint) {
    score += 45;
    reasons.push('x265/HEVC');
  }

  if (options.kind === 'movie' && (asNumber(release.size) ?? 0) > 13 * 1024 * 1024 * 1024) {
    score -= 240;
    reasons.push('movie larger than 13 GB');
  }

  if (releaser && preferredReleasers.includes(releaser)) {
    score += 160;
    reasons.push(`preferred releaser ${releaser}`);
  }

  if (options.preferredReleaser && releaser === options.preferredReleaser.toLowerCase()) {
    score += 220;
    reasons.push(`matched proven releaser ${options.preferredReleaser}`);
  }

  if (signals.subtitleHint) {
    score += 16;
    reasons.push('subtitle hint in title');
  } else if (preferences.requireSubtitles) {
    reasons.push('no subtitle hint');
  }

  const protocol = asString(release.protocol) ?? 'unknown';
  if (protocol.toLowerCase() === 'usenet') {
    score += 4;
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
  preferences: Preferences,
  options: ReleaseSelectionOptions
): ReleaseSelection {
  const evaluated = rawReleases
    .map((entry) => buildCandidate(asRecord(entry), preferences, options))
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
