import {
  evaluateReleaseCandidates,
  selectBestEvaluatedRelease,
  type EvaluatedRelease,
} from '$lib/server/release-score';
import { arrFetch, isArrFetchError } from '$lib/server/arr-client';
import {
  manualSelectionQueuedStatus,
  type PersistedAcquisitionJob,
  type PersistedManualSelection,
} from '$lib/server/acquisition-domain';
import { extractReleaser } from '$lib/server/media-identity';
import { asNumber, asRecord } from '$lib/server/raw';
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

function selectMappedReleases(
  kind: MediaKind,
  releases: unknown[],
  createdId: number,
): Record<string, unknown>[] {
  return releases
    .map(asRecord)
    .filter((release) =>
      kind === 'movie'
        ? asNumber(release.mappedMovieId) === createdId
        : asNumber(release.mappedSeriesId) === createdId,
    );
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
  failedGuids: string[],
  selectedGuid: string | null,
): ManualReleaseResult[] {
  return orderManualReleaseResults(
    inventory.evaluated.map((release) => toManualReleaseResult(release, selectedGuid, failedGuids)),
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

function releaseOptions(job: PersistedAcquisitionJob) {
  return {
    kind: job.kind,
    preferredReleaser: job.preferredReleaser,
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

function mapManualReleaseStatus(
  release: EvaluatedRelease,
  blockReason: ManualReleaseBlockReason | null,
  selectedGuid: string | null,
  failedGuids: string[],
): ManualReleaseResult['status'] {
  if (release.candidate.guid === selectedGuid) {
    return 'selected';
  }

  if (failedGuids.includes(release.candidate.guid)) {
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
  failedGuids: string[],
): ManualReleaseResult {
  const blockReason =
    release.candidate.guid === selectedGuid
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
    status: mapManualReleaseStatus(release, blockReason, selectedGuid, failedGuids),
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
  const inventory = await fetchReleaseInventory(job);
  const autoCandidates = inventory.evaluated.filter(
    (release) => !job.failedGuids.includes(release.candidate.guid),
  );
  const selection = selectBestEvaluatedRelease(autoCandidates, inventory.mappedReleases);
  const selectedGuid = selection.decision.selected?.guid ?? null;

  return {
    manualResults: orderManualReleaseResults(
      inventory.evaluated.map((release) =>
        toManualReleaseResult(release, selectedGuid, job.failedGuids),
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
          manualReleaseResultsFromInventory(inventory, job.failedGuids, selectedGuid),
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
        toManualReleaseResult(release, matched.candidate.guid, job.failedGuids),
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

  await arrFetch<unknown>(job.sourceService, '/api/v3/release', {
    method: 'POST',
    body: JSON.stringify({
      guid: selection.decision.selected.guid,
      indexerId: selection.decision.selected.indexerId,
    }),
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
