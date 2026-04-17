import { normalizeToken } from '$lib/server/media-identity';
import { scopeFromTarget, seriesScopeOverlapsTarget } from '$lib/server/series-scope';
import type { QueueItem } from '$lib/shared/types';

type ManagedQueueTarget = {
  arrItemId: number;
  currentRelease: string | null;
  kind: 'movie' | 'series';
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
    .some((candidate) => expected.includes(candidate) || candidate.includes(expected));
}

function isSameArrIdentity(target: ManagedQueueTarget, item: QueueItem): boolean {
  return (
    item.arrItemId !== null &&
    item.arrItemId === target.arrItemId &&
    item.kind === target.kind &&
    item.sourceService === target.sourceService
  );
}

export function queueItemMatchesManagedTarget(
  target: ManagedQueueTarget,
  item: QueueItem,
): boolean {
  if (!isSameArrIdentity(target, item)) {
    return false;
  }

  if (target.kind === 'movie') {
    return true;
  }

  const targetScope = scopeFromTarget(target);
  const itemHasEpisodeIds = Array.isArray(item.episodeIds) && item.episodeIds.length > 0;
  const itemHasSeasonNumbers = Array.isArray(item.seasonNumbers) && item.seasonNumbers.length > 0;
  if (itemHasEpisodeIds && seriesScopeOverlapsTarget(targetScope, item)) {
    return true;
  }

  if (!targetScope.episodeIds && itemHasSeasonNumbers && seriesScopeOverlapsTarget(targetScope, item)) {
    return true;
  }

  return releaseMatchesTarget(target.currentRelease, item);
}
