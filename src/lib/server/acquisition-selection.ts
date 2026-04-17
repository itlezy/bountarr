import {
  evaluateReleaseCandidates,
  selectBestEvaluatedRelease,
  type EvaluatedRelease,
} from '$lib/server/release-score';
import { arrFetch } from '$lib/server/arr-client';
import {
  manualSelectionQueuedStatus,
  type PersistedAcquisitionJob,
  type PersistedManualSelection,
} from '$lib/server/acquisition-domain';
import { extractReleaser } from '$lib/server/media-identity';
import { asNumber, asRecord } from '$lib/server/raw';
import { defaultPreferences } from '$lib/shared/preferences';
import type {
  ManualReleaseListResponse,
  ManualReleaseResult,
  MediaKind,
  ReleaseDecisionCandidate,
} from '$lib/shared/types';

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
  mappedReleases: number;
  releasesFound: number;
  selectedGuid: string | null;
  selectedRelease: ReleaseDecisionCandidate | null;
  selection: ReturnType<typeof selectBestEvaluatedRelease>;
};

export function persistManualSelection(
  result: ReleaseSelectionResult,
): PersistedManualSelection {
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
    downloadAllowed: true,
    identityReason: result.selection.decision.reason,
    identityStatus: 'exact-match',
    scopeReason: null,
    scopeStatus: 'not-applicable',
    selectionBlockedReason: null,
    rejectedByArr: false,
    rejectionReasons: [],
    status: 'selected',
  };

  return {
    decision: {
      ...result.selection.decision,
      selected: result.selection.decision.selected,
    },
    payload: structuredClone(result.selection.payload),
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
        status: 'selected',
      },
    ],
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
  if (
    job.queueStatus !== manualSelectionQueuedStatus ||
    !job.queuedManualSelection
  ) {
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
  selectedGuid: string | null,
  failedGuids: string[],
): ManualReleaseResult['status'] {
  if (release.candidate.guid === selectedGuid) {
    return 'selected';
  }

  if (failedGuids.includes(release.candidate.guid)) {
    return 'previously-failed';
  }

  if (release.arrRejected) {
    return 'arr-rejected';
  }

  return release.autoSelectable ? 'accepted' : 'locally-rejected';
}

function canSelectManualRelease(
  release: EvaluatedRelease,
  selectedGuid: string | null,
): boolean {
  return (
    !release.arrRejected &&
    manualSelectionBlockedReason(release) === null &&
    release.candidate.guid !== selectedGuid
  );
}

function manualSelectionBlockedReason(release: EvaluatedRelease): string | null {
  if (release.arrRejected) {
    return null;
  }

  if (release.scopeStatus !== 'not-applicable' && release.scopeStatus !== 'exact') {
    return (
      release.scopeReason ?? 'This release cannot satisfy the targeted scope for the active grab.'
    );
  }

  return null;
}

function toManualReleaseResult(
  release: EvaluatedRelease,
  selectedGuid: string | null,
  failedGuids: string[],
): ManualReleaseResult {
  return {
    ...release.candidate,
    canSelect: canSelectManualRelease(release, selectedGuid),
    downloadAllowed: !release.arrRejected || release.rejectionReasons.length === 0,
    identityReason: release.identityReason,
    identityStatus: release.identityStatus,
    scopeReason: release.scopeReason,
    scopeStatus: release.scopeStatus,
    selectionBlockedReason: manualSelectionBlockedReason(release),
    rejectedByArr: release.arrRejected,
    rejectionReasons: release.rejectionReasons,
    status: mapManualReleaseStatus(release, selectedGuid, failedGuids),
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
  const queuedResults = queuedManualReleaseResults(job);
  if (queuedResults) {
    return queuedResults;
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
): Promise<ReleaseSelectionResult> {
  const inventory = await fetchReleaseInventory(job);
  const matched = inventory.evaluated.find(
    (release) => release.candidate.guid === guid && release.candidate.indexerId === indexerId,
  );

  if (!matched) {
    throw new Error('The selected manual-search release is no longer available.');
  }

  if (matched.arrRejected) {
    const rejectionReason =
      matched.rejectionReasons.find(
        (reason) => reason !== 'Arr marked this release as not downloadable',
      ) ??
      matched.rejectionReasons[0] ??
      'Arr marked the selected release as not downloadable.';
    throw new Error(
      rejectionReason,
    );
  }

  const blockedReason = manualSelectionBlockedReason(matched);
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  const selection = {
    payload: matched.payload,
    decision: {
      accepted: inventory.evaluated.filter((release) => release.autoSelectable).length,
      considered: inventory.mappedReleases,
      reason: `User selected ${matched.candidate.title}: ${matched.candidate.reason}`,
      selected: matched.candidate,
    },
  } satisfies ReturnType<typeof selectBestEvaluatedRelease>;

  return {
    manualResults: orderManualReleaseResults(
      inventory.evaluated.map((release) =>
        toManualReleaseResult(release, matched.candidate.guid, job.failedGuids),
      ),
    ),
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
    selectedTitle: result.selection.decision.selected?.title ?? null,
    selectedReleaser: result.selection.decision.selected
      ? extractReleaser(result.selection.decision.selected.title)
      : null,
    selectionReason: result.selection.decision.reason,
  };
}
