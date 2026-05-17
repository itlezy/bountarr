import { languageMatchesPreferred, preferredLanguageMatchers } from '$lib/shared/languages';
import {
  classifySeriesScopeMatch,
  extractSeriesScope,
  scopeFromTarget,
  titleSuggestsCompleteSeriesPack,
} from '$lib/server/series-scope';
import type {
  Preferences,
  AcquisitionReasonCode,
  ReleaseDecision,
  ReleaseDecisionCandidate,
  ReleaseArrOverrideMode,
  ReleaseAutoBlockedReason,
  ReleaseAutoDecision,
  ReleaseIdentityStatus,
  ReleaseScopeStatus,
  ReleaseYearMatch,
} from '$lib/shared/types';

type ReleaseSelection = {
  decision: ReleaseDecision;
  payload: Record<string, unknown> | null;
};

export type EvaluatedRelease = {
  acceptedByLocalRules: boolean;
  adjacentYearFallback: boolean;
  arrRejected: boolean;
  arrOverrideMode: ReleaseArrOverrideMode;
  autoBlockedReason: ReleaseAutoBlockedReason | null;
  autoDecision: ReleaseAutoDecision;
  autoSelectable: boolean;
  candidate: ReleaseDecisionCandidate;
  identityReason: string;
  identityStatus: ReleaseIdentityStatus;
  payload: Record<string, unknown>;
  rejectionReasons: string[];
  scopeReason: string | null;
  scopeStatus: ReleaseScopeStatus;
  yearMatch: ReleaseYearMatch;
};

type ReleaseSelectionOptions = {
  failedIndexerIds?: readonly number[] | null;
  failedReleasers?: readonly string[] | null;
  kind: 'movie' | 'series';
  preferredReleaser?: string | null;
  retryReasonCode?: AcquisitionReasonCode | null;
  targetEpisodeIds?: number[] | null;
  targetYear?: number | null;
  targetSeasonNumbers?: number[] | null;
  targetTitle: string;
};

type ReleaseSignals = {
  genericSubtitleHint: boolean;
  multiLanguageHint: boolean;
  preferredAudioTitleHint: boolean;
  subtitleLanguageMetadataMatch: boolean;
  subtitleLanguageTitleHint: boolean;
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

function normalizeHintText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseLanguages(value: unknown): string[] {
  const languages = new Set<string>();
  const direct = asString(value);
  if (direct) {
    for (const entry of direct.split(/[/,;|]+/)) {
      const candidate = entry.trim();
      if (candidate.length > 0) {
        languages.add(candidate);
      }
    }
  }

  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const languageRecord = asRecord(record.language);
    const candidates = [
      asString(record.name) ??
        asString(record.displayName) ??
        asString(record.value) ??
        asString(record.language) ??
        asString(languageRecord.name) ??
        asString(languageRecord.displayName) ??
        asString(languageRecord.value) ??
        asString(entry),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      for (const part of candidate.split(/[/,;|]+/)) {
        const language = part.trim();
        if (language.length > 0) {
          languages.add(language);
        }
      }
    }
  }

  return [...languages];
}

function titleHintTokens(value: string): string[] {
  return normalizeHintText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function titleHasLanguageHint(title: string, language: Preferences['preferredLanguage']): boolean {
  if (language === 'Any') {
    return false;
  }

  const tokens = titleHintTokens(title);
  const tokenSet = new Set(tokens);
  const normalizedTitle = ` ${tokens.join(' ')} `;
  return preferredLanguageMatchers(language).some(
    (matcher) => tokenSet.has(matcher) || normalizedTitle.includes(` ${matcher} `),
  );
}

function parseSubtitleLanguages(release: Record<string, unknown>): string[] {
  return [
    ...new Set([
      ...parseLanguages(release.subtitleLanguages),
      ...parseLanguages(release.subtitles),
      ...parseLanguages(release.subtitleLanguage),
      ...parseLanguages(release.subs),
    ]),
  ];
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
  return [
    ...new Set(values.filter((value): value is string => value !== null && value.length > 0)),
  ];
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

function extractReleaseYear(title: string): number | null {
  for (const token of title
    .normalize('NFKD')
    .replace(/[[\]()]/g, ' ')
    .split(/[\s._-]+/)) {
    const normalized = normalizeIdentityText(token);
    if (maybeYearToken(normalized)) {
      return Number(normalized);
    }
  }

  return null;
}

function extractReleaseTitleSegment(title: string): string {
  const rawTokens = title
    .normalize('NFKD')
    .replace(/[[\]()]/g, ' ')
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
): {
  autoSelectable: boolean;
  reason: string;
  scopeReason: string | null;
  scopeStatus: ReleaseScopeStatus;
  status: ReleaseIdentityStatus;
} {
  const titleIdentity = classifyTitleIdentity(release, options);
  if (titleIdentity.status === 'mismatch') {
    return {
      ...titleIdentity,
      autoSelectable: false,
      scopeReason: null,
      scopeStatus: 'not-applicable',
    };
  }

  if (
    options.kind !== 'series' ||
    (!options.targetEpisodeIds?.length && !options.targetSeasonNumbers?.length)
  ) {
    return {
      ...titleIdentity,
      autoSelectable: true,
      scopeReason: null,
      scopeStatus: 'not-applicable',
    };
  }

  const targetScope = scopeFromTarget(options);
  const scopeMatch = classifySeriesScopeMatch(targetScope, extractSeriesScope(release));
  if (scopeMatch.status === 'mismatch') {
    return {
      autoSelectable: false,
      reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
      scopeReason: scopeMatch.reason,
      scopeStatus: scopeMatch.status,
      status: 'mismatch',
    };
  }

  if (scopeMatch.status === 'exact') {
    return {
      autoSelectable: true,
      reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
      scopeReason: scopeMatch.reason,
      scopeStatus: scopeMatch.status,
      status: titleIdentity.status,
    };
  }

  const releaseTitle = asString(release.title);
  if (titleSuggestsCompleteSeriesPack(releaseTitle)) {
    const scopeReason = 'Release looks like a complete-series pack outside the targeted scope.';
    return {
      autoSelectable: false,
      reason: `${titleIdentity.reason}; ${scopeReason}`,
      scopeReason,
      scopeStatus: 'mismatch',
      status: 'mismatch',
    };
  }

  return {
    autoSelectable: false,
    reason: `${titleIdentity.reason}; ${scopeMatch.reason}`,
    scopeReason: scopeMatch.reason,
    scopeStatus: scopeMatch.status,
    status: 'weak-match',
  };
}

function titleSignals(title: string, preferences: Preferences): ReleaseSignals {
  const titleTokens = titleHintTokens(title);
  const titleTokenSet = new Set(titleTokens);
  const adjacentTokens = (left: string, right: string) =>
    titleTokens.some((token, index) => token === left && titleTokens[index + 1] === right);
  const subtitleLanguageTitleHint = titleHasLanguageHint(title, preferences.subtitleLanguage);
  const genericSubtitleHint =
    titleTokenSet.has('sub') ||
    titleTokenSet.has('subs') ||
    titleTokenSet.has('subbed') ||
    titleTokenSet.has('softsub') ||
    titleTokenSet.has('softsubs') ||
    titleTokenSet.has('multisub') ||
    titleTokenSet.has('multisubs') ||
    titleTokenSet.has('vost') ||
    titleTokenSet.has('vostfr') ||
    adjacentTokens('multi', 'sub') ||
    adjacentTokens('multi', 'subs') ||
    adjacentTokens('soft', 'sub') ||
    adjacentTokens('soft', 'subs');
  const multiLanguageHint =
    titleTokenSet.has('multi') ||
    titleTokenSet.has('multilang') ||
    titleTokenSet.has('multilanguage') ||
    titleTokenSet.has('dualaudio') ||
    adjacentTokens('dual', 'audio');

  return {
    genericSubtitleHint: preferences.subtitleLanguage !== 'Any' && genericSubtitleHint,
    multiLanguageHint,
    preferredAudioTitleHint: titleHasLanguageHint(title, preferences.preferredLanguage),
    subtitleLanguageMetadataMatch: false,
    subtitleLanguageTitleHint,
    x265Hint: /\bx265\b|\bhevc\b/i.test(title),
    sourceMatch: sourceWeights.find((entry) => entry.pattern.test(title)) ?? null,
  };
}

export function releaseRejectionReasons(release: Record<string, unknown>): string[] {
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

export function isExistingFileArrRejection(reasons: string[]): boolean {
  return (
    reasons.some(
      (reason) =>
        /not an upgrade for existing .* file/i.test(reason) ||
        /not a custom format upgrade for existing .* file/i.test(reason),
    ) &&
    reasons.every(
      (reason) =>
        reason === 'Arr marked this release as not downloadable' ||
        /not an upgrade for existing .* file/i.test(reason) ||
        /not a custom format upgrade for existing .* file/i.test(reason),
    )
  );
}

function extractReleaser(title: string): string | null {
  const trimmed = title.trim();
  const candidate = trimmed.split('-').at(-1)?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,}$/.test(candidate) ? candidate.toLowerCase() : null;
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
  releaseRejectionReasons: string[],
  title: string,
  options: { allowAutomaticArrOverride: boolean; automaticArrOverrideReason: string | null } = {
    allowAutomaticArrOverride: false,
    automaticArrOverrideReason: null,
  },
): void {
  if (releaseRejectionReasons.length > 0) {
    if (isExistingFileArrRejection(releaseRejectionReasons)) {
      state.reasons.push(...releaseRejectionReasons);
    } else if (options.allowAutomaticArrOverride) {
      state.reasons.push(...releaseRejectionReasons);
      if (options.automaticArrOverrideReason !== null) {
        state.reasons.push(options.automaticArrOverrideReason);
      }
    } else {
      for (const rejection of releaseRejectionReasons) {
        rejectCandidate(state, rejection);
      }
    }
  }

  if (hardRejectPatterns.some((pattern) => pattern.test(title))) {
    rejectCandidate(state, 'blocked releaser or source pattern');
  }
}

function releaseYearMatch(
  release: Record<string, unknown>,
  releaseTitle: string,
  targetYear: number | null | undefined,
): ReleaseYearMatch {
  if (targetYear === null || targetYear === undefined) {
    return 'not-applicable';
  }

  const releaseYear =
    asNumber(release.year) ??
    asNumber(release.releaseYear) ??
    asNumber(release.movieYear) ??
    extractReleaseYear(releaseTitle);

  if (releaseYear === null) {
    return 'unknown';
  }

  if (releaseYear === targetYear) {
    return 'exact';
  }

  return Math.abs(releaseYear - targetYear) === 1 ? 'adjacent' : 'mismatch';
}

function isUnknownMovieArrRejection(reasons: string[]): boolean {
  return reasons.some((reason) => /unknown movie/i.test(reason));
}

function automaticArrOverrideMode(
  release: Record<string, unknown>,
  title: string,
  options: ReleaseSelectionOptions,
  identity: ReturnType<typeof classifyIdentity>,
  arrRejectionReasons: string[],
): 'exact-year' | 'adjacent-year' | null {
  if (
    options.kind !== 'movie' ||
    arrRejectionReasons.length === 0 ||
    isExistingFileArrRejection(arrRejectionReasons) ||
    identity.status !== 'exact-match'
  ) {
    return null;
  }

  const yearMatch = releaseYearMatch(release, title, options.targetYear);
  if (yearMatch === 'exact') {
    return 'exact-year';
  }

  return yearMatch === 'adjacent' && isUnknownMovieArrRejection(arrRejectionReasons)
    ? 'adjacent-year'
    : null;
}

function automaticArrOverrideReason(mode: 'exact-year' | 'adjacent-year' | null): string | null {
  switch (mode) {
    case 'exact-year':
      return 'Bountarr title/year matched target for Arr rejection override';
    case 'adjacent-year':
      return 'Bountarr accepted adjacent release year because no exact-year match was available';
    default:
      return null;
  }
}

function releaseAutoBlockedReason({
  acceptedByLocalRules,
  arrOverrideMode,
  arrRejectionReasons,
  autoSelectable,
  identity,
  yearMatch,
}: {
  acceptedByLocalRules: boolean;
  arrOverrideMode: 'exact-year' | 'adjacent-year' | null;
  arrRejectionReasons: string[];
  autoSelectable: boolean;
  identity: ReturnType<typeof classifyIdentity>;
  yearMatch: ReleaseYearMatch;
}): ReleaseAutoBlockedReason | null {
  if (autoSelectable) {
    return null;
  }

  if (identity.status === 'mismatch') {
    return 'title-mismatch';
  }

  if (identity.scopeStatus !== 'not-applicable' && identity.scopeStatus !== 'exact') {
    return 'scope-mismatch';
  }

  if (arrRejectionReasons.length > 0 && arrOverrideMode === null) {
    if (yearMatch === 'mismatch') {
      return 'year-mismatch';
    }

    if (yearMatch === 'unknown' || yearMatch === 'not-applicable') {
      return 'year-unknown';
    }

    return 'arr-rejected';
  }

  if (!acceptedByLocalRules) {
    return 'local-rules';
  }

  if (arrOverrideMode === 'adjacent-year') {
    return 'adjacent-year-superseded';
  }

  return null;
}

function releaseAutoDecision(
  autoSelectable: boolean,
  blockedReason: ReleaseAutoBlockedReason | null,
): ReleaseAutoDecision {
  if (autoSelectable) {
    return 'auto-selected';
  }

  switch (blockedReason) {
    case 'local-rules':
    case 'scope-mismatch':
    case 'title-mismatch':
    case 'year-mismatch':
    case 'year-unknown':
      return 'blocked';
    default:
      return 'reviewable';
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
  if (preferences.preferredLanguage !== 'Any') {
    if (preferredLanguageMatch) {
      awardCandidate(state, 140, `preferred audio ${preferences.preferredLanguage} metadata`);
    } else if (signals.preferredAudioTitleHint) {
      awardCandidate(state, 110, `${preferences.preferredLanguage} audio hint in title`);
    } else if (signals.multiLanguageHint) {
      awardCandidate(
        state,
        70,
        `multi-language audio may include ${preferences.preferredLanguage}`,
      );
    } else {
      state.reasons.push(`no clear ${preferences.preferredLanguage} audio evidence`);
    }
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

  if (releaser && options.failedReleasers?.includes(releaser)) {
    awardCandidate(state, -180, `penalized previously failed releaser ${releaser}`);
  }

  if (options.failedIndexerIds?.includes(asNumber(release.indexerId) ?? Number.NaN)) {
    awardCandidate(state, -90, 'penalized previously failed indexer');
  }

  if (preferences.subtitleLanguage !== 'Any') {
    if (signals.subtitleLanguageMetadataMatch) {
      awardCandidate(state, 110, `${preferences.subtitleLanguage} subtitle metadata`);
    } else if (signals.genericSubtitleHint && signals.subtitleLanguageTitleHint) {
      awardCandidate(state, 100, `${preferences.subtitleLanguage} subtitle hint in title`);
    } else if (signals.genericSubtitleHint) {
      awardCandidate(state, 55, 'subtitle hint in title');
    } else if (signals.subtitleLanguageTitleHint) {
      awardCandidate(state, 35, `${preferences.subtitleLanguage} language hint in title`);
    } else {
      state.reasons.push(`no clear ${preferences.subtitleLanguage} subtitle evidence`);
    }
  }

  const protocol = asString(release.protocol) ?? 'unknown';
  if (protocol.toLowerCase() === 'usenet') {
    awardCandidate(state, 4, 'usenet');
  }
}

function applyRetryBonuses(
  state: CandidateScoreState,
  preferences: Preferences,
  options: ReleaseSelectionOptions,
  signals: ReleaseSignals,
  preferredLanguageMatch: boolean,
): void {
  if (options.retryReasonCode === 'missing-audio' && preferences.preferredLanguage !== 'Any') {
    if (preferredLanguageMatch) {
      awardCandidate(state, 220, `retry prefers ${preferences.preferredLanguage} audio metadata`);
    } else if (signals.preferredAudioTitleHint) {
      awardCandidate(state, 170, `retry prefers ${preferences.preferredLanguage} audio title hint`);
    } else if (signals.multiLanguageHint) {
      awardCandidate(
        state,
        120,
        `retry prefers multi-language audio for ${preferences.preferredLanguage}`,
      );
    } else {
      awardCandidate(
        state,
        -90,
        `retry penalty: no ${preferences.preferredLanguage} audio evidence`,
      );
    }
  }

  if (options.retryReasonCode === 'missing-subs' && preferences.subtitleLanguage !== 'Any') {
    if (signals.subtitleLanguageMetadataMatch) {
      awardCandidate(state, 240, `retry prefers ${preferences.subtitleLanguage} subtitle metadata`);
    } else if (signals.genericSubtitleHint && signals.subtitleLanguageTitleHint) {
      awardCandidate(
        state,
        200,
        `retry prefers ${preferences.subtitleLanguage} subtitle title hint`,
      );
    } else if (signals.genericSubtitleHint) {
      awardCandidate(state, 140, 'retry prefers subtitle title hint');
    } else {
      awardCandidate(
        state,
        -90,
        `retry penalty: no ${preferences.subtitleLanguage} subtitle evidence`,
      );
    }
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
  signals.subtitleLanguageMetadataMatch = languageMatchesPreferred(
    parseSubtitleLanguages(release),
    preferences.subtitleLanguage,
  );
  const preferredLanguageMatch = languageMatchesPreferred(languages, preferences.preferredLanguage);
  const releaser = extractReleaser(title);
  const state = createScoreState(release);
  const identity = classifyIdentity(release, options);
  const arrRejectionReasons = releaseRejectionReasons(release);
  const arrOverrideMode = automaticArrOverrideMode(
    release,
    title,
    options,
    identity,
    arrRejectionReasons,
  );
  const yearMatch = releaseYearMatch(release, title, options.targetYear);

  applyAvailabilityRules(state, arrRejectionReasons, title, {
    allowAutomaticArrOverride: arrOverrideMode !== null,
    automaticArrOverrideReason:
      arrOverrideMode === 'adjacent-year' ? null : automaticArrOverrideReason(arrOverrideMode),
  });
  applyPreferenceBonuses(
    state,
    preferences,
    options,
    release,
    signals,
    preferredLanguageMatch,
    releaser,
  );
  applyRetryBonuses(state, preferences, options, signals, preferredLanguageMatch);

  const acceptedByLocalRules = state.score > ACCEPTED_SCORE_FLOOR;
  // Manual selection may still allow mismatches, but auto-selection must never promote them.
  const adjacentYearFallback = arrOverrideMode === 'adjacent-year';
  const autoSelectable = acceptedByLocalRules && identity.autoSelectable && !adjacentYearFallback;
  const autoBlockedReason = releaseAutoBlockedReason({
    acceptedByLocalRules,
    arrOverrideMode,
    arrRejectionReasons,
    autoSelectable,
    identity,
    yearMatch,
  });

  return {
    acceptedByLocalRules,
    adjacentYearFallback,
    arrRejected: arrRejectionReasons.length > 0,
    arrOverrideMode: arrOverrideMode ?? 'none',
    autoBlockedReason,
    autoDecision: releaseAutoDecision(autoSelectable, autoBlockedReason),
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
    rejectionReasons: arrRejectionReasons,
    scopeReason: identity.scopeReason,
    scopeStatus: identity.scopeStatus,
    yearMatch,
  };
}

function promoteAdjacentYearFallbacks(
  evaluated: EvaluatedRelease[],
  options: ReleaseSelectionOptions,
): EvaluatedRelease[] {
  if (options.kind !== 'movie' || options.targetYear === null || options.targetYear === undefined) {
    return evaluated;
  }

  const exactYearAutoCandidateExists = evaluated.some(
    (release) =>
      release.autoSelectable &&
      release.identityStatus === 'exact-match' &&
      release.yearMatch === 'exact',
  );
  if (exactYearAutoCandidateExists) {
    return evaluated;
  }

  return evaluated.map((release) => {
    if (
      !release.adjacentYearFallback ||
      !release.acceptedByLocalRules ||
      release.identityStatus !== 'exact-match'
    ) {
      return release;
    }

    return {
      ...release,
      autoSelectable: true,
      autoBlockedReason: null,
      autoDecision: 'auto-selected',
      candidate: {
        ...release.candidate,
        reason: [release.candidate.reason, automaticArrOverrideReason('adjacent-year')].join('; '),
      },
    };
  });
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
  const evaluated = rawReleases
    .map((entry) => buildCandidate(asRecord(entry), preferences, options))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return promoteAdjacentYearFallbacks(evaluated, options);
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
