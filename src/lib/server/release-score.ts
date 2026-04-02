import { languageMatchesPreferred } from '$lib/shared/languages';
import type { Preferences, ReleaseDecision, ReleaseDecisionCandidate } from '$lib/shared/types';

type ReleaseSelection = {
  decision: ReleaseDecision;
  payload: Record<string, unknown> | null;
};

export type EvaluatedRelease = {
  acceptedByLocalRules: boolean;
  arrRejected: boolean;
  candidate: ReleaseDecisionCandidate;
  payload: Record<string, unknown>;
  rejectionReasons: string[];
};

type ReleaseSelectionOptions = {
  kind: 'movie' | 'series';
  preferredReleaser?: string | null;
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

  return {
    acceptedByLocalRules: state.score > ACCEPTED_SCORE_FLOOR,
    arrRejected: releaseRejectionReasons.length > 0,
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
  const accepted = evaluated.filter((entry) => entry.acceptedByLocalRules);
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
