import { languageMatchesPreferred } from '$lib/shared/languages';
import {
  classifySeriesScopeMatch,
  extractSeriesScope,
  scopeFromTarget,
  titleSuggestsCompleteSeriesPack,
} from '$lib/server/series-scope';
import type {
  Preferences,
  ReleaseDecision,
  ReleaseDecisionCandidate,
  ReleaseIdentityStatus,
} from '$lib/shared/types';

type ReleaseSelection = {
  decision: ReleaseDecision;
  payload: Record<string, unknown> | null;
};

export type EvaluatedRelease = {
  acceptedByLocalRules: boolean;
  arrRejected: boolean;
  autoSelectable: boolean;
  candidate: ReleaseDecisionCandidate;
  identityReason: string;
  identityStatus: ReleaseIdentityStatus;
  payload: Record<string, unknown>;
  rejectionReasons: string[];
};

type ReleaseSelectionOptions = {
  kind: 'movie' | 'series';
  preferredReleaser?: string | null;
  targetEpisodeIds?: number[] | null;
  targetSeasonNumbers?: number[] | null;
  targetTitle: string;
};

type ReleaseSignals = {
  subtitleHint: boolean;
  multiLanguageHint: boolean;
  x265Hint: boolean;
  sourceMatch: (typeof sourceWeights)[number] | null;
};

type CandidateScoreState = {
  score: number;
  reasons: string[];
};

const REJECTED_SCORE = -10_000;
const ACCEPTED_SCORE_FLOOR = -900;

// These groups consistently win in this library, so give them a stable bonus.
const preferredReleasers = ['flux', 'ntb', 'framestor'];

// These patterns are treated as hard blocks regardless of the Arr-provided score.
const hardRejectPatterns = [/\byts\b/i, /\bpsa\b/i, /\bcam\b/i, /(^|[\s.-])ts($|[\s.-])/i];

// Local source preferences sit on top of Arr quality weights to break close ties.
const sourceWeights: Array<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /\bweb[\s.-]?dl\b/i, score: 120, label: 'WEB-DL' },
  { pattern: /\bwebrip\b/i, score: 80, label: 'WEBRip' },
  { pattern: /\bblu[\s.-]?ray\b/i, score: 40, label: 'BluRay' },
];

const romanNumerals = new Map<string, string>([
  ['i', '1'],
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['vi', '6'],
  ['vii', '7'],
  ['viii', '8'],
  ['ix', '9'],
  ['x', '10'],
]);

const releaseNoiseTokens = new Set([
  '1080p',
  '2160p',
  '720p',
  '480p',
  '576p',
  '4k',
  '8k',
  'webrip',
  'web',
  'webdl',
  'web-dl',
  'bluray',
  'blu',
  'ray',
  'bdrip',
  'brrip',
  'remux',
  'hdtv',
  'hdrip',
  'dvdrip',
  'dvd',
  'proper',
  'repack',
  'internal',
  'extended',
  'criterion',
  'uncut',
  'unrated',
  'limited',
  'complete',
  'multi',
  'multi',
  'dual',
  'audio',
  'dd',
  'ddp',
  'dts',
  'atmos',
  'aac',
  'ac3',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'hdr',
  'dv',
  'dubbed',
  'subbed',
  'subs',
  'proper',
  'readnfo',
  'torrent',
  'usenet',
]);

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

function normalizeIdentityText(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return '';
  }

  return normalized
    .split(/\s+/)
    .map((token) => romanNumerals.get(token) ?? token)
    .join(' ');
}

function titleTokens(value: string): string[] {
  const normalized = normalizeIdentityText(value);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value.length > 0))];
}

function parseStructuredTitles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.flatMap((entry) => {
        const record = asRecord(entry);
        return [
          asString(record.title),
          asString(record.name),
          asString(record.value),
          asString(record.cleanTitle),
          asString(entry),
        ];
      }),
    );
  }

  const single = asString(value);
  return single ? [single] : [];
}

function extractStructuredTitles(
  release: Record<string, unknown>,
  kind: 'movie' | 'series',
): string[] {
  return kind === 'movie'
    ? parseStructuredTitles(release.movieTitles)
    : parseStructuredTitles(release.seriesTitles);
}

function maybeYearToken(token: string): boolean {
  return /^(19|20)\d{2}$/.test(token);
}

function extractReleaseTitleSegment(title: string): string {
  const rawTokens = title
    .normalize('NFKD')
    .replace(/[\[\]()]/g, ' ')
    .split(/[\s._-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const chosen: string[] = [];

  for (const token of rawTokens) {
    const normalized = normalizeIdentityText(token);
    if (!normalized) {
      continue;
    }

    if (maybeYearToken(normalized)) {
      break;
    }

    if (releaseNoiseTokens.has(normalized)) {
      break;
    }

    chosen.push(token);
  }

  if (chosen.length === 0) {
    return title;
  }

  return chosen.join(' ');
}

function isStrongTitleMatch(target: string, candidate: string): boolean {
  return normalizeIdentityText(target) === normalizeIdentityText(candidate);
}

function isWeakTitleMatch(target: string, candidate: string): boolean {
  const targetNormalized = normalizeIdentityText(target);
  const candidateNormalized = normalizeIdentityText(candidate);

  if (!targetNormalized || !candidateNormalized) {
    return false;
  }

  if (targetNormalized === candidateNormalized) {
    return true;
  }

  const targetParts = titleTokens(target);
  const candidateParts = titleTokens(candidate);
  if (targetParts.length === 0 || candidateParts.length === 0) {
    return false;
  }

  const matchingParts = targetParts.filter((part) => candidateParts.includes(part)).length;
  return (
    matchingParts === targetParts.length &&
    Math.abs(candidateParts.length - targetParts.length) <= 1
  );
}

function classifyTitleIdentity(
  release: Record<string, unknown>,
  options: ReleaseSelectionOptions,
): { reason: string; status: ReleaseIdentityStatus } {
  const releaseTitle = asString(release.title);
  const structuredTitles = extractStructuredTitles(release, options.kind);
  const exactStructuredMatch = structuredTitles.find((entry) =>
    isStrongTitleMatch(options.targetTitle, entry),
  );

  // Arr mapping can be wrong, so structured title lists must agree before a release can be
  // considered safe for automatic selection.
  if (structuredTitles.length > 0) {
    if (exactStructuredMatch) {
      return {
        status: 'exact-match',
        reason: `Structured ${options.kind} title matched ${exactStructuredMatch}`,
      };
    }

    return {
      status: 'mismatch',
      reason: `Structured ${options.kind} titles point to a different title: ${structuredTitles.join(', ')}`,
    };
  }

  if (!releaseTitle) {
    return {
      status: 'mismatch',
      reason: 'Release is missing a usable title',
    };
  }

  const titleSegment = extractReleaseTitleSegment(releaseTitle);
  if (isStrongTitleMatch(options.targetTitle, titleSegment)) {
    return {
      status: 'exact-match',
      reason: `Release title matched ${options.targetTitle}`,
    };
  }

  if (isWeakTitleMatch(options.targetTitle, titleSegment)) {
    return {
      status: 'weak-match',
      reason: `Release title partially matched ${options.targetTitle}`,
    };
  }

  return {
    status: 'mismatch',
    reason: `Release title points to ${titleSegment}`,
  };
}

function classifyIdentity(
  release: Record<string, unknown>,
  options: ReleaseSelectionOptions,
): { autoSelectable: boolean; reason: string; status: ReleaseIdentityStatus } {
  const titleIdentity = classifyTitleIdentity(release, options);
  if (titleIdentity.status === 'mismatch') {
    return {
      ...titleIdentity,
      autoSelectable: false,
    };
  }

  if (
    options.kind !== 'series' ||
    (!options.targetEpisodeIds?.length && !options.targetSeasonNumbers?.length)
  ) {
    return {
      ...titleIdentity,
      autoSelectable: true,
    };
  }

  const targetScope = scopeFromTarget(options);
  const scopeMatch = classifySeriesScopeMatch(targetScope, extractSeriesScope(release));
  if (scopeMatch.status === 'mismatch') {
    return {
      autoSelectable: false,
      reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
      status: 'mismatch',
    };
  }

  if (scopeMatch.status === 'exact') {
    return {
      autoSelectable: true,
      reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
      status: titleIdentity.status,
    };
  }

  const releaseTitle = asString(release.title);
  if (titleSuggestsCompleteSeriesPack(releaseTitle)) {
    return {
      autoSelectable: false,
      reason: `${titleIdentity.reason}; release looks like a complete-series pack outside the targeted scope`,
      status: 'mismatch',
    };
  }

  return {
    autoSelectable: false,
    reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
    status: 'weak-match',
  };
}

function titleSignals(title: string, preferences: Preferences): ReleaseSignals {
  const normalized = normalizeToken(title);

  return {
    subtitleHint:
      preferences.subtitleLanguage !== 'Any' &&
      /(sub|subs|subbed|multisub|multi sub|multi-sub|vostfr|softsub)/.test(normalized),
    multiLanguageHint: /(multi|dual audio|dual-audio)/.test(normalized),
    x265Hint: /\bx265\b|\bhevc\b/i.test(title),
    sourceMatch: sourceWeights.find((entry) => entry.pattern.test(title)) ?? null,
  };
}

function rejectionReasons(release: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  if (release.downloadAllowed !== true) {
    reasons.push('Arr marked this release as not downloadable');
  }

  if (release.rejected === true) {
    const mapped = asArray(release.rejections)
      .map((entry) => asString(entry))
      .filter((entry): entry is string => entry !== null);
    reasons.push(...(mapped.length > 0 ? mapped : ['Arr rejected this release']));
  }

  return reasons;
}

function extractReleaser(title: string): string | null {
  const trimmed = title.trim();
  const candidate = trimmed.split('-').at(-1)?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,}$/.test(candidate) ? candidate.toLowerCase() : null;
}

function includesEnglish(languages: string[], title: string): boolean {
  if (languageMatchesPreferred(languages, 'English')) {
    return true;
  }

  return /\beng\b|\benglish\b/i.test(title);
}

function createScoreState(release: Record<string, unknown>): CandidateScoreState {
  return {
    score:
      (asNumber(release.qualityWeight) ?? 0) +
      (asNumber(release.releaseWeight) ?? 0) +
      (asNumber(release.customFormatScore) ?? 0) * 5,
    reasons: [],
  };
}

function rejectCandidate(state: CandidateScoreState, reason: string): void {
  state.score = REJECTED_SCORE;
  state.reasons.push(reason);
}

function awardCandidate(state: CandidateScoreState, score: number, reason: string): void {
  state.score += score;
  state.reasons.push(reason);
}

function applyAvailabilityRules(
  state: CandidateScoreState,
  release: Record<string, unknown>,
  title: string,
  hasEnglish: boolean,
  preferredLanguageMatch: boolean,
  enforceAudioRules: boolean,
  isMultiAudio: boolean,
): void {
  for (const rejection of rejectionReasons(release)) {
    rejectCandidate(state, rejection);
  }

  if (hardRejectPatterns.some((pattern) => pattern.test(title))) {
    rejectCandidate(state, 'blocked releaser or source pattern');
  }

  if (enforceAudioRules && (!hasEnglish || (!preferredLanguageMatch && !isMultiAudio))) {
    rejectCandidate(state, 'missing English audio');
  }
}

function applyPreferenceBonuses(
  state: CandidateScoreState,
  preferences: Preferences,
  options: ReleaseSelectionOptions,
  release: Record<string, unknown>,
  signals: ReleaseSignals,
  preferredLanguageMatch: boolean,
  releaser: string | null,
): void {
  if (preferredLanguageMatch) {
    awardCandidate(state, 120, `preferred audio ${preferences.preferredLanguage}`);
  }

  if (signals.multiLanguageHint) {
    awardCandidate(state, 18, 'multi-language release');
  }

  if (signals.sourceMatch) {
    awardCandidate(state, signals.sourceMatch.score, `${signals.sourceMatch.label} source`);
  }

  if (signals.x265Hint) {
    awardCandidate(state, 45, 'x265/HEVC');
  }

  if (options.kind === 'movie' && (asNumber(release.size) ?? 0) > 13 * 1024 * 1024 * 1024) {
    awardCandidate(state, -240, 'movie larger than 13 GB');
  }

  if (releaser && preferredReleasers.includes(releaser)) {
    awardCandidate(state, 160, `preferred releaser ${releaser}`);
  }

  if (options.preferredReleaser && releaser === options.preferredReleaser.toLowerCase()) {
    awardCandidate(state, 220, `matched proven releaser ${options.preferredReleaser}`);
  }

  if (signals.subtitleHint) {
    awardCandidate(state, 16, `${preferences.subtitleLanguage} subtitle hint in title`);
  } else if (preferences.subtitleLanguage !== 'Any') {
    state.reasons.push(`no ${preferences.subtitleLanguage} subtitle hint`);
  }

  const protocol = asString(release.protocol) ?? 'unknown';
  if (protocol.toLowerCase() === 'usenet') {
    awardCandidate(state, 4, 'usenet');
  }
}

function buildCandidate(
  release: Record<string, unknown>,
  preferences: Preferences,
  options: ReleaseSelectionOptions,
): EvaluatedRelease | null {
  const guid = asString(release.guid);
  const indexerId = asNumber(release.indexerId);
  const title = asString(release.title);

  if (!guid || !indexerId || !title) {
    return null;
  }

  const languages = parseLanguages(release.languages);
  const signals = titleSignals(title, preferences);
  const preferredLanguageMatch = languageMatchesPreferred(languages, preferences.preferredLanguage);
  const enforceAudioRules = preferences.preferredLanguage !== 'Any';
  const releaser = extractReleaser(title);
  const isMultiAudio = signals.multiLanguageHint || /\bmulti\b|\bdual[ .-]?audio\b/i.test(title);
  const hasEnglish = includesEnglish(languages, title);
  const state = createScoreState(release);
  const identity = classifyIdentity(release, options);

  applyAvailabilityRules(
    state,
    release,
    title,
    hasEnglish,
    preferredLanguageMatch,
    enforceAudioRules,
    isMultiAudio,
  );
  applyPreferenceBonuses(
    state,
    preferences,
    options,
    release,
    signals,
    preferredLanguageMatch,
    releaser,
  );

  const releaseRejectionReasons = rejectionReasons(release);
  const acceptedByLocalRules = state.score > ACCEPTED_SCORE_FLOOR;
  // Manual selection may still allow mismatches, but auto-selection must never promote them.
  const autoSelectable = acceptedByLocalRules && identity.autoSelectable;

  return {
    acceptedByLocalRules,
    arrRejected: releaseRejectionReasons.length > 0,
    autoSelectable,
    candidate: {
      title,
      guid,
      indexer: asString(release.indexer) ?? 'Unknown',
      indexerId,
      protocol: asString(release.protocol) ?? 'unknown',
      size: asNumber(release.size) ?? 0,
      languages,
      score: state.score,
      reason: state.reasons.join('; ') || 'Arr score only',
    },
    identityReason: identity.reason,
    identityStatus: identity.status,
    payload: release,
    rejectionReasons: releaseRejectionReasons,
  };
}

function orderAcceptedCandidates(accepted: EvaluatedRelease[]): EvaluatedRelease[] {
  // Keep the selection deterministic: score first, then larger release, then title.
  return [...accepted].sort((left, right) => {
    if (left.candidate.score !== right.candidate.score) {
      return right.candidate.score - left.candidate.score;
    }

    if (left.candidate.size !== right.candidate.size) {
      return right.candidate.size - left.candidate.size;
    }

    return left.candidate.title.localeCompare(right.candidate.title);
  });
}

export function evaluateReleaseCandidates(
  rawReleases: unknown[],
  preferences: Preferences,
  options: ReleaseSelectionOptions,
): EvaluatedRelease[] {
  return rawReleases
    .map((entry) => buildCandidate(asRecord(entry), preferences, options))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function selectBestEvaluatedRelease(
  evaluated: EvaluatedRelease[],
  considered = evaluated.length,
): ReleaseSelection {
  const accepted = evaluated.filter((entry) => entry.autoSelectable);
  const ordered = orderAcceptedCandidates(accepted);
  const selected = ordered[0] ?? null;

  if (!selected) {
    return {
      payload: null,
      decision: {
        considered,
        accepted: accepted.length,
        selected: null,
        reason:
          considered === 0
            ? 'No manual-search releases were returned by Arr'
            : 'No acceptable release passed the local scoring rules',
      },
    };
  }

  return {
    payload: selected.payload,
    decision: {
      considered,
      accepted: accepted.length,
      selected: selected.candidate,
      reason: `Picked ${selected.candidate.title}: ${selected.candidate.reason}`,
    },
  };
}

export function selectBestRelease(
  rawReleases: unknown[],
  preferences: Preferences,
  options: ReleaseSelectionOptions,
): ReleaseSelection {
  return selectBestEvaluatedRelease(
    evaluateReleaseCandidates(rawReleases, preferences, options),
    rawReleases.length,
  );
}
