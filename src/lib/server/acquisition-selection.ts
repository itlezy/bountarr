import {
  evaluateReleaseCandidates,
  releaseRejectionReasons,
  selectBestEvaluatedRelease,
  type EvaluatedRelease,
} from '$lib/server/release-score';
import { arrFetch, isArrFetchError } from '$lib/server/arr-client';
import {
  manualSelectionQueuedStatus,
  type PersistedAcquisitionReleaseCandidate,
  type PersistedAcquisitionJob,
  type PersistedManualSelection,
} from '$lib/server/acquisition-domain';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { extractReleaser, normalizeToken } from '$lib/server/media-identity';
import { asNumber, asPositiveNumber, asRecord, asString } from '$lib/server/raw';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { defaultPreferences } from '$lib/shared/preferences';
import type {
  ManualReleaseBlockReason,
  ManualReleaseListResponse,
  ManualReleaseResult,
  ManualReleaseSelectionMode,
  MediaKind,
  ReleaseDecisionCandidate,
} from '$lib/shared/types';

const logger = createAreaLogger('acquisition.selection');
const movieReleaseFallbackProfileNames = ['Any', 'AnyAnyLang'] as const;

function selectMappedReleases(
  kind: MediaKind,
  releases: unknown[],
  createdId: number,
): Record<string, unknown>[] {
  return releases.map(asRecord).filter((release) => {
    if (kind === 'movie') {
      const mappedMovieId = asNumber(release.mappedMovieId);
      return mappedMovieId === null || mappedMovieId === createdId;
    }

    return asNumber(release.mappedSeriesId) === createdId;
  });
}

export type ReleaseSelectionResult = {
  manualResults: ManualReleaseResult[];
  manualSelectionMode: ManualReleaseSelectionMode | null;
  mappedReleases: number;
  releasesFound: number;
  selectedGuid: string | null;
  selectedRelease: ReleaseDecisionCandidate | null;
  selection: ReturnType<typeof selectBestEvaluatedRelease>;
};

export function persistManualSelection(result: ReleaseSelectionResult): PersistedManualSelection {
  if (!result.selection.payload || !result.selection.decision.selected) {
    throw new Error('A selected manual release is required before persisting it.');
  }

  const selectedResult = result.manualResults.find(
    (release) =>
      release.guid === result.selection.decision.selected?.guid &&
      release.indexerId === result.selection.decision.selected?.indexerId,
  ) ?? {
    ...structuredClone(result.selection.decision.selected),
    canSelect: false,
    selectionMode: result.manualSelectionMode ?? 'direct',
    blockReason: 'already-selected',
    identityStatus: 'exact-match',
    scopeStatus: 'not-applicable',
    explanation: {
      summary: result.selection.decision.reason,
      matchReasons: [result.selection.decision.reason],
      warningReasons: [],
      arrReasons: [],
    },
    status: 'selected',
  };

  return {
    decision: {
      ...result.selection.decision,
      selected: result.selection.decision.selected,
    },
    payload: structuredClone(result.selection.payload),
    selectionMode: result.manualSelectionMode ?? 'direct',
    selectedResult: structuredClone(selectedResult),
  };
}

export function restoreManualSelection(
  selection: PersistedManualSelection,
): ReleaseSelectionResult {
  return {
    manualResults: [
      {
        ...structuredClone(selection.selectedResult),
        canSelect: false,
        blockReason: 'already-selected',
        selectionMode: null,
        status: 'selected',
      },
    ],
    manualSelectionMode: selection.selectionMode,
    mappedReleases: selection.decision.considered,
    releasesFound: selection.decision.considered,
    selectedGuid: selection.decision.selected.guid,
    selectedRelease: selection.decision.selected,
    selection: {
      decision: selection.decision,
      payload: structuredClone(selection.payload),
    },
  };
}

export function queuedManualReleaseResults(
  job: Pick<PersistedAcquisitionJob, 'id' | 'queueStatus' | 'queuedManualSelection'>,
): ManualReleaseListResponse | null {
  if (job.queueStatus !== manualSelectionQueuedStatus || !job.queuedManualSelection) {
    return null;
  }

  const restored = restoreManualSelection(job.queuedManualSelection);
  return {
    jobId: job.id,
    releases: restored.manualResults,
    selectedGuid: restored.selectedGuid,
    summary: restored.selection.decision.reason,
    updatedAt: new Date().toISOString(),
  };
}

function manualReleaseResultsFromInventory(
  inventory: ReleaseInventory,
  failedReleaseKeys: string[],
  selectedGuid: string | null,
  selectedIndexerId: number | null,
): ManualReleaseResult[] {
  return orderManualReleaseResults(
    inventory.evaluated.map((release) =>
      toManualReleaseResult(release, selectedGuid, selectedIndexerId, failedReleaseKeys),
    ),
  );
}

function mergeQueuedManualResult(
  releases: ManualReleaseResult[],
  selection: PersistedManualSelection | null,
): ManualReleaseResult[] {
  if (!selection) {
    return releases;
  }

  const selected = selection.decision.selected;
  const present = releases.some(
    (release) => release.guid === selected.guid && release.indexerId === selected.indexerId,
  );
  if (present) {
    return releases;
  }

  return orderManualReleaseResults([
    ...releases,
    {
      ...structuredClone(selection.selectedResult),
      canSelect: false,
      status: 'selected',
    },
  ]);
}

type ReleaseInventory = {
  evaluated: EvaluatedRelease[];
  mappedReleases: number;
  rawMappedReleases: Record<string, unknown>[];
  releasesFound: number;
};

function releaseKey(guid: string, indexerId: number): string {
  return `${guid}:${indexerId}`;
}

function releaseKeyFromCandidate(candidate: Pick<ReleaseDecisionCandidate, 'guid' | 'indexerId'>) {
  return releaseKey(candidate.guid, candidate.indexerId);
}

function releaseKeyFromEvaluated(release: EvaluatedRelease): string {
  return releaseKeyFromCandidate(release.candidate);
}

function failedCandidateKeys(job: PersistedAcquisitionJob): string[] {
  return (job.releaseCandidates ?? [])
    .filter((candidate) => candidate.status === 'failed')
    .map(releaseKeyFromCandidate);
}

function manualSelectionModeFromArrRejected(arrRejected: boolean): ManualReleaseSelectionMode {
  return arrRejected ? 'override-arr-rejection' : 'direct';
}

function mergeReleaseCandidatePool(
  existing: PersistedAcquisitionReleaseCandidate[],
  evaluated: EvaluatedRelease[],
): PersistedAcquisitionReleaseCandidate[] {
  const now = new Date().toISOString();
  const byKey = new Map(
    existing.map((candidate) => [releaseKeyFromCandidate(candidate), candidate]),
  );

  for (const release of evaluated) {
    const key = releaseKeyFromEvaluated(release);
    const current = byKey.get(key);
    byKey.set(key, {
      ...release.candidate,
      acceptedByLocalRules: release.acceptedByLocalRules,
      arrRejected: release.arrRejected,
      attempt: current?.attempt ?? null,
      autoSelectable: release.autoSelectable,
      detectedAudioLanguages: current?.detectedAudioLanguages ?? [],
      detectedSubtitleLanguages: current?.detectedSubtitleLanguages ?? [],
      failedAt: current?.failedAt ?? null,
      failureReason: current?.failureReason ?? null,
      firstSeenAt: current?.firstSeenAt ?? now,
      identityReason: release.identityReason,
      identityStatus: release.identityStatus,
      lastSeenAt: now,
      payload: release.payload,
      rejectionReasons: release.rejectionReasons,
      scopeReason: release.scopeReason,
      scopeStatus: release.scopeStatus,
      selectionMode: manualSelectionModeFromArrRejected(release.arrRejected),
      status:
        current?.status === 'failed' || current?.status === 'selected'
          ? current.status
          : 'available',
    });
  }

  return [...byKey.values()].sort((left, right) => {
    if (left.status !== right.status) {
      const rank = { selected: 0, available: 1, failed: 2 };
      return rank[left.status] - rank[right.status];
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return left.title.localeCompare(right.title);
  });
}

function evaluatedFromPersisted(candidate: PersistedAcquisitionReleaseCandidate): EvaluatedRelease {
  return {
    acceptedByLocalRules: candidate.acceptedByLocalRules,
    arrRejected: candidate.arrRejected,
    autoSelectable: candidate.autoSelectable,
    candidate,
    identityReason: candidate.identityReason,
    identityStatus: candidate.identityStatus,
    payload: candidate.payload,
    rejectionReasons: candidate.rejectionReasons,
    scopeReason: candidate.scopeReason,
    scopeStatus: candidate.scopeStatus,
  };
}

function releaseOptions(job: PersistedAcquisitionJob) {
  const failedCandidates = (job.releaseCandidates ?? []).filter(
    (candidate) => candidate.status === 'failed',
  );
  return {
    failedIndexerIds: [...new Set(failedCandidates.map((candidate) => candidate.indexerId))],
    failedReleasers: [
      ...new Set(
        failedCandidates
          .map((candidate) => extractReleaser(candidate.title))
          .filter((releaser): releaser is string => releaser !== null),
      ),
    ],
    kind: job.kind,
    preferredReleaser: job.preferredReleaser,
    retryReasonCode: job.reasonCode,
    targetEpisodeIds: job.targetEpisodeIds,
    targetSeasonNumbers: job.targetSeasonNumbers,
    targetTitle: job.title,
  } as const;
}

async function fetchReleaseInventory(job: PersistedAcquisitionJob): Promise<ReleaseInventory> {
  const releases = await arrFetch<unknown[]>(
    job.sourceService,
    '/api/v3/release',
    undefined,
    job.kind === 'movie' ? { movieId: job.arrItemId } : { seriesId: job.arrItemId },
  );
  const rawMappedReleases = selectMappedReleases(job.kind, releases, job.arrItemId);

  return {
    evaluated: evaluateReleaseCandidates(
      rawMappedReleases,
      {
        cardsView: defaultPreferences.cardsView,
        preferredLanguage: job.preferences.preferredLanguage,
        subtitleLanguage: job.preferences.subtitleLanguage,
        theme: 'system',
      },
      releaseOptions(job),
    ),
    mappedReleases: rawMappedReleases.length,
    rawMappedReleases,
    releasesFound: releases.length,
  };
}

function fallbackQualityProfileIds(
  profiles: unknown[],
  originalQualityProfileId: number | null,
): number[] {
  const profileIdByName = new Map<string, number>();
  for (const profile of profiles.map(asRecord)) {
    const name = asString(profile.name);
    const id = asPositiveNumber(profile.id);
    if (!name || id === null) {
      continue;
    }

    profileIdByName.set(normalizeToken(name), id);
  }

  const ids: number[] = [];
  for (const profileName of movieReleaseFallbackProfileNames) {
    const id = profileIdByName.get(normalizeToken(profileName));
    if (id === undefined || id === originalQualityProfileId || ids.includes(id)) {
      continue;
    }

    ids.push(id);
  }

  return ids;
}

async function fetchTrackedMovie(job: PersistedAcquisitionJob): Promise<Record<string, unknown>> {
  return asRecord(await arrFetch<unknown>(job.sourceService, `/api/v3/movie/${job.arrItemId}`));
}

async function updateTrackedMovieQualityProfile(
  job: PersistedAcquisitionJob,
  qualityProfileId: number,
): Promise<void> {
  const path = `/api/v3/movie/${job.arrItemId}`;
  const current = await fetchTrackedMovie(job);
  if (asPositiveNumber(current.qualityProfileId) === qualityProfileId) {
    return;
  }

  await arrFetch<unknown>(job.sourceService, path, {
    method: 'PUT',
    body: JSON.stringify({
      ...current,
      qualityProfileId,
    }),
  });
}

function persistJobQualityProfile(
  job: PersistedAcquisitionJob,
  qualityProfileId: number,
): PersistedAcquisitionJob {
  if ((job.qualityProfileId ?? null) === qualityProfileId) {
    return job;
  }

  const jobs = getAcquisitionJobRepository();
  if (!jobs.hasJob(job.id)) {
    return {
      ...job,
      qualityProfileId,
    };
  }

  return jobs.updateJob(job.id, { qualityProfileId });
}

async function fetchReleaseInventoryWithFallback(job: PersistedAcquisitionJob): Promise<{
  inventory: ReleaseInventory;
  job: PersistedAcquisitionJob;
}> {
  const initialInventory = await fetchReleaseInventory(job);
  if (
    job.kind !== 'movie' ||
    job.sourceService !== 'radarr' ||
    initialInventory.mappedReleases > 0
  ) {
    return { inventory: initialInventory, job };
  }

  const originalMovie = await fetchTrackedMovie(job);
  const originalQualityProfileId =
    asPositiveNumber(originalMovie.qualityProfileId) ?? job.qualityProfileId ?? null;
  const profiles = await arrFetch<unknown[]>(job.sourceService, '/api/v3/qualityprofile');
  const fallbackProfileIds = fallbackQualityProfileIds(profiles, originalQualityProfileId);
  let fallbackJob = job;
  let latestInventory = initialInventory;

  for (const qualityProfileId of fallbackProfileIds) {
    await updateTrackedMovieQualityProfile(fallbackJob, qualityProfileId);
    fallbackJob = persistJobQualityProfile(fallbackJob, qualityProfileId);
    latestInventory = await fetchReleaseInventory(fallbackJob);
    if (latestInventory.mappedReleases > 0) {
      logger.info('Movie release search found candidates after relaxing quality profile', {
        arrItemId: fallbackJob.arrItemId,
        jobId: fallbackJob.id,
        qualityProfileId,
        title: fallbackJob.title,
      });
      return { inventory: latestInventory, job: fallbackJob };
    }
  }

  if (
    originalQualityProfileId !== null &&
    (fallbackJob.qualityProfileId ?? null) !== originalQualityProfileId
  ) {
    await updateTrackedMovieQualityProfile(fallbackJob, originalQualityProfileId);
    fallbackJob = persistJobQualityProfile(fallbackJob, originalQualityProfileId);
  }

  return { inventory: latestInventory, job: fallbackJob };
}

function mapManualReleaseStatus(
  release: EvaluatedRelease,
  blockReason: ManualReleaseBlockReason | null,
  selectedGuid: string | null,
  selectedIndexerId: number | null,
  failedReleaseKeys: string[],
): ManualReleaseResult['status'] {
  if (
    release.candidate.guid === selectedGuid &&
    release.candidate.indexerId === selectedIndexerId
  ) {
    return 'selected';
  }

  if (failedReleaseKeys.includes(releaseKeyFromCandidate(release.candidate))) {
    return 'previously-failed';
  }

  if (blockReason !== null) {
    return 'locally-rejected';
  }

  if (release.arrRejected) {
    return 'arr-rejected';
  }

  return release.autoSelectable ? 'accepted' : 'locally-rejected';
}

function manualSelectionMode(release: EvaluatedRelease): ManualReleaseSelectionMode {
  return release.arrRejected ? 'override-arr-rejection' : 'direct';
}

function manualSelectionBlockReason(release: EvaluatedRelease): ManualReleaseBlockReason | null {
  if (release.scopeStatus !== 'not-applicable' && release.scopeStatus !== 'exact') {
    return 'scope-mismatch';
  }

  if (release.identityStatus === 'mismatch') {
    return 'title-mismatch';
  }

  return null;
}

function manualSelectionWarningReasons(release: EvaluatedRelease): string[] {
  const warnings: string[] = [];

  if (
    release.identityStatus === 'mismatch' &&
    (release.scopeStatus === 'not-applicable' || release.scopeStatus === 'exact')
  ) {
    warnings.push(release.identityReason);
  }

  if (release.scopeStatus !== 'not-applicable' && release.scopeStatus !== 'exact') {
    warnings.push(
      release.scopeReason ?? 'This release cannot satisfy the targeted scope for the active grab.',
    );
  }

  return warnings;
}

function manualSelectionMatchReasons(release: EvaluatedRelease): string[] {
  const reasons = [release.identityReason];

  if (release.scopeReason && release.scopeStatus === 'exact') {
    reasons.push(release.scopeReason);
  }

  return [...new Set(reasons)];
}

function toManualReleaseResult(
  release: EvaluatedRelease,
  selectedGuid: string | null,
  selectedIndexerId: number | null,
  failedReleaseKeys: string[],
): ManualReleaseResult {
  const blockReason =
    release.candidate.guid === selectedGuid && release.candidate.indexerId === selectedIndexerId
      ? 'already-selected'
      : manualSelectionBlockReason(release);
  const canSelect = blockReason === null;

  return {
    ...release.candidate,
    canSelect,
    selectionMode: canSelect ? manualSelectionMode(release) : null,
    blockReason,
    identityStatus: release.identityStatus,
    scopeStatus: release.scopeStatus,
    explanation: {
      summary: release.candidate.reason,
      matchReasons: manualSelectionMatchReasons(release),
      warningReasons: manualSelectionWarningReasons(release),
      arrReasons: [...release.rejectionReasons],
    },
    status: mapManualReleaseStatus(
      release,
      blockReason,
      selectedGuid,
      selectedIndexerId,
      failedReleaseKeys,
    ),
  };
}

function orderManualReleaseResults(releases: ManualReleaseResult[]): ManualReleaseResult[] {
  const rank = (status: ManualReleaseResult['status']) => {
    switch (status) {
      case 'selected':
        return 0;
      case 'accepted':
        return 1;
      case 'locally-rejected':
        return 2;
      case 'arr-rejected':
        return 3;
      default:
        return 4;
    }
  };

  return [...releases].sort((left, right) => {
    const statusDifference = rank(left.status) - rank(right.status);
    if (statusDifference !== 0) {
      return statusDifference;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    if (left.size !== right.size) {
      return right.size - left.size;
    }

    return left.title.localeCompare(right.title);
  });
}

export async function findReleaseSelection(
  job: PersistedAcquisitionJob,
): Promise<ReleaseSelectionResult> {
  const jobs = getAcquisitionJobRepository();
  const currentJob = jobs.getJob(job.id) ?? job;
  const { inventory, job: searchedJob } = await fetchReleaseInventoryWithFallback(currentJob);
  const releaseCandidates = mergeReleaseCandidatePool(
    searchedJob.releaseCandidates ?? [],
    inventory.evaluated,
  );
  const persistedJob = jobs.replaceReleaseCandidates(job.id, releaseCandidates) ?? {
    ...searchedJob,
    releaseCandidates,
  };
  const persistedReleaseCandidates = persistedJob.releaseCandidates ?? [];
  const failedReleaseKeys = failedCandidateKeys(persistedJob);
  const failedReleaseKeySet = new Set(failedReleaseKeys);
  const legacyFailedGuidSet = new Set(
    failedReleaseKeys.length === 0 ? persistedJob.failedGuids : [],
  );
  const autoCandidates = persistedReleaseCandidates
    .filter((candidate) => candidate.status === 'available')
    .filter(
      (candidate) =>
        !failedReleaseKeySet.has(releaseKeyFromCandidate(candidate)) &&
        !legacyFailedGuidSet.has(candidate.guid),
    )
    .map(evaluatedFromPersisted)
    .filter((release) => release.autoSelectable);
  const selection = selectBestEvaluatedRelease(autoCandidates, inventory.mappedReleases);
  if (
    !selection.decision.selected &&
    persistedReleaseCandidates.length > 0 &&
    persistedReleaseCandidates.every((candidate) => candidate.status === 'failed')
  ) {
    selection.decision.reason = 'No untried release candidates remain for this acquisition job';
  }
  const selectedGuid = selection.decision.selected?.guid ?? null;
  const selectedIndexerId = selection.decision.selected?.indexerId ?? null;

  return {
    manualResults: orderManualReleaseResults(
      persistedReleaseCandidates.map((release) =>
        toManualReleaseResult(
          evaluatedFromPersisted(release),
          selectedGuid,
          selectedIndexerId,
          legacyFailedGuidSet.has(release.guid)
            ? [...failedReleaseKeys, releaseKeyFromCandidate(release)]
            : failedReleaseKeys,
        ),
      ),
    ),
    manualSelectionMode: null,
    mappedReleases: inventory.mappedReleases,
    releasesFound: inventory.releasesFound,
    selectedGuid,
    selectedRelease: selection.decision.selected,
    selection,
  };
}

export async function getManualReleaseResults(
  job: PersistedAcquisitionJob,
): Promise<ManualReleaseListResponse> {
  if (job.queueStatus === manualSelectionQueuedStatus && job.queuedManualSelection) {
    try {
      const inventory = await fetchReleaseInventory(job);
      const selectedGuid = job.queuedManualSelection.decision.selected.guid;
      return {
        jobId: job.id,
        releases: mergeQueuedManualResult(
          manualReleaseResultsFromInventory(
            inventory,
            (job.releaseCandidates ?? [])
              .filter((candidate) => candidate.status === 'failed')
              .map(releaseKeyFromCandidate),
            selectedGuid,
            job.queuedManualSelection.decision.selected.indexerId,
          ),
          job.queuedManualSelection,
        ),
        selectedGuid,
        summary: job.queuedManualSelection.decision.reason,
        updatedAt: new Date().toISOString(),
      };
    } catch (refreshError) {
      if (!isArrFetchError(refreshError)) {
        logger.error('Queued manual release refresh failed unexpectedly', {
          jobId: job.id,
          service: job.sourceService,
          ...toErrorLogContext(refreshError),
        });
        throw refreshError;
      }

      logger.warn('Queued manual release refresh failed; returning persisted selection', {
        jobId: job.id,
        service: job.sourceService,
        ...toErrorLogContext(refreshError),
      });

      return (
        queuedManualReleaseResults(job) ?? {
          jobId: job.id,
          releases: [],
          selectedGuid: null,
          summary: 'Saved manual selection is waiting to be submitted.',
          updatedAt: new Date().toISOString(),
        }
      );
    }
  }

  const selection = await findReleaseSelection(job);
  return {
    jobId: job.id,
    releases: selection.manualResults,
    selectedGuid: selection.selectedGuid,
    summary: selection.selection.decision.reason,
    updatedAt: new Date().toISOString(),
  };
}

export async function findManualReleaseSelection(
  job: PersistedAcquisitionJob,
  guid: string,
  indexerId: number,
  selectionMode: ManualReleaseSelectionMode,
): Promise<ReleaseSelectionResult> {
  const inventory = await fetchReleaseInventory(job);
  const matched = inventory.evaluated.find(
    (release) => release.candidate.guid === guid && release.candidate.indexerId === indexerId,
  );

  if (!matched) {
    throw new Error('The selected manual-search release is no longer available.');
  }

  const requiredSelectionMode = manualSelectionMode(matched);
  if (matched.arrRejected && selectionMode !== 'override-arr-rejection') {
    const rejectionReason =
      matched.rejectionReasons.find(
        (reason) => reason !== 'Arr marked this release as not downloadable',
      ) ??
      matched.rejectionReasons[0] ??
      'Arr marked the selected release as not downloadable.';
    throw new Error(rejectionReason);
  }

  if (!matched.arrRejected && selectionMode !== 'direct') {
    throw new Error('Only Arr-rejected releases can use Arr override selection.');
  }

  const blockedReason = manualSelectionWarningReasons(matched)[0];
  const blockReasonKind = manualSelectionBlockReason(matched);
  if (blockReasonKind !== null && blockedReason) {
    throw new Error(blockedReason);
  }

  const selection = {
    payload: matched.payload,
    decision: {
      accepted: inventory.evaluated.filter((release) => release.autoSelectable).length,
      considered: inventory.mappedReleases,
      reason: `${
        requiredSelectionMode === 'override-arr-rejection'
          ? 'User overrode Arr rejection and selected'
          : 'User selected'
      } ${matched.candidate.title}: ${matched.candidate.reason}`,
      selected: matched.candidate,
    },
  } satisfies ReturnType<typeof selectBestEvaluatedRelease>;

  return {
    manualResults: orderManualReleaseResults(
      inventory.evaluated.map((release) =>
        toManualReleaseResult(
          release,
          matched.candidate.guid,
          matched.candidate.indexerId,
          (job.releaseCandidates ?? [])
            .filter((candidate) => candidate.status === 'failed')
            .map(releaseKeyFromCandidate),
        ),
      ),
    ),
    manualSelectionMode: requiredSelectionMode,
    mappedReleases: inventory.mappedReleases,
    releasesFound: inventory.releasesFound,
    selectedGuid: matched.candidate.guid,
    selectedRelease: matched.candidate,
    selection,
  };
}

export async function submitSelectedRelease(
  job: PersistedAcquisitionJob,
  selection: ReturnType<typeof selectBestEvaluatedRelease>,
): Promise<void> {
  if (!selection.payload || !selection.decision.selected) {
    return;
  }

  const overrideArrRejection = releaseRejectionReasons(selection.payload).length > 0;

  await arrFetch<unknown>(job.sourceService, '/api/v3/release', {
    method: 'POST',
    body: JSON.stringify(
      overrideArrRejection
        ? {
            ...selection.payload,
            guid: selection.decision.selected.guid,
            indexerId: selection.decision.selected.indexerId,
            shouldOverride: true,
          }
        : {
            guid: selection.decision.selected.guid,
            indexerId: selection.decision.selected.indexerId,
          },
    ),
  });
}

export function selectionLogContext(result: ReleaseSelectionResult): Record<string, unknown> {
  return {
    considered: result.selection.decision.considered,
    accepted: result.selection.decision.accepted,
    manualSelectionMode: result.manualSelectionMode,
    selectedTitle: result.selection.decision.selected?.title ?? null,
    selectedReleaser: result.selection.decision.selected
      ? extractReleaser(result.selection.decision.selected.title)
      : null,
    selectionReason: result.selection.decision.reason,
  };
}
