import { normalizeToken } from '$lib/server/media-identity';
import {
  extractSeriesScope,
  scopeFromTarget,
  seriesScopeBelongsToTarget,
} from '$lib/server/series-scope';
import type { QueueItem } from '$lib/shared/types';

export type ManagedQueueTarget = {
  arrItemId: number;
  currentRelease: string | null;
  kind: 'movie' | 'series';
  liveDownloadId?: string | null;
  liveQueueId?: number | null;
  sourceService: 'radarr' | 'sonarr';
  targetEpisodeIds: number[] | null;
  targetSeasonNumbers: number[] | null;
};

function normalizedReleaseText(value: string | null): string {
  return value ? normalizeToken(value) : '';
}

function releaseMatchesTarget(currentRelease: string | null, item: QueueItem): boolean {
  const expected = normalizedReleaseText(currentRelease);
  if (!expected) {
    return false;
  }

  return [item.detail ?? item.title]
    .map((value) => normalizedReleaseText(value))
    .filter((value) => value.length > 0)
    .some((candidate) => candidate === expected);
}

function hasManagedQueueIdentity(target: ManagedQueueTarget): boolean {
  return (target.liveQueueId ?? null) !== null || Boolean(target.liveDownloadId);
}

function isSameArrIdentity(target: ManagedQueueTarget, item: QueueItem): boolean {
  return (
    item.arrItemId !== null &&
    item.arrItemId === target.arrItemId &&
    item.kind === target.kind &&
    item.sourceService === target.sourceService
  );
}

export function queueItemMatchesManagedIdentity(
  target: ManagedQueueTarget,
  item: QueueItem,
): boolean {
  if (!isSameArrIdentity(target, item)) {
    return false;
  }

  if ((target.liveQueueId ?? null) !== null && item.queueId === target.liveQueueId) {
    return true;
  }

  return Boolean(
    target.liveDownloadId &&
      item.downloadId &&
      item.downloadId === target.liveDownloadId,
  );
}

export function queueItemMatchesManagedTarget(
  target: ManagedQueueTarget,
  item: QueueItem,
): boolean {
  if (!isSameArrIdentity(target, item)) {
    return false;
  }

  if (queueItemMatchesManagedIdentity(target, item)) {
    return true;
  }

  if (target.kind === 'movie') {
    return !hasManagedQueueIdentity(target);
  }

  const targetScope = scopeFromTarget(target);
  const itemScope = extractSeriesScope(item);
  if (itemScope.episodeIds || itemScope.seasonNumbers) {
    return seriesScopeBelongsToTarget(targetScope, itemScope);
  }

  return releaseMatchesTarget(target.currentRelease, item);
}

export function bestQueueIdentityCandidate(
  target: ManagedQueueTarget,
  items: QueueItem[],
): QueueItem | null {
  let bestMatch: QueueItem | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const item of items) {
    if (!queueItemMatchesManagedTarget(target, item)) {
      continue;
    }

    let priority = 4;
    if (queueItemMatchesManagedIdentity(target, item)) {
      priority = 0;
    } else if (target.kind === 'movie') {
      priority = releaseMatchesTarget(target.currentRelease, item) ? 1 : 2;
    } else {
      const itemScope = extractSeriesScope(item);
      priority =
        itemScope.episodeIds || itemScope.seasonNumbers
          ? 1
          : releaseMatchesTarget(target.currentRelease, item)
            ? 2
            : 3;
    }

    if (priority < bestPriority) {
      bestPriority = priority;
      bestMatch = item;
    }
  }

  return bestMatch;
}
