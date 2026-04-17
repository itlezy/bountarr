import type { ManagedQueueLiveSummary, QueueItem } from '$lib/shared/types';

function sumKnownMetric(
  items: QueueItem[],
  selector: (item: QueueItem) => number | null,
): { partial: boolean; value: number | null } {
  let hasKnownValue = false;
  let partial = false;
  let total = 0;

  for (const item of items) {
    const value = selector(item);
    if (value === null) {
      partial = true;
      continue;
    }

    hasKnownValue = true;
    total += value;
  }

  return {
    partial,
    value: hasKnownValue ? total : null,
  };
}

function summarizeLiveProgress(items: QueueItem[]): number | null {
  const itemsWithWeightedProgress = items.filter(
    (item) => item.progress !== null && item.size !== null && item.size > 0,
  );
  if (itemsWithWeightedProgress.length === items.length && itemsWithWeightedProgress.length > 0) {
    const totalSize = itemsWithWeightedProgress.reduce((sum, item) => sum + (item.size ?? 0), 0);
    if (totalSize > 0) {
      const weightedProgress = itemsWithWeightedProgress.reduce(
        (sum, item) => sum + (item.progress ?? 0) * (item.size ?? 0),
        0,
      );
      return Math.max(0, Math.min(100, weightedProgress / totalSize));
    }
  }

  const knownProgress = items
    .map((item) => item.progress)
    .filter((value): value is number => value !== null);
  if (knownProgress.length > 0) {
    return knownProgress.reduce((sum, value) => sum + value, 0) / knownProgress.length;
  }

  const completeByteMetrics = items.filter(
    (item) => item.size !== null && item.sizeLeft !== null && item.size > 0,
  );
  if (completeByteMetrics.length === items.length && completeByteMetrics.length > 0) {
    const totalSize = completeByteMetrics.reduce((sum, item) => sum + (item.size ?? 0), 0);
    if (totalSize > 0) {
      const totalDownloaded = completeByteMetrics.reduce(
        (sum, item) => sum + Math.max(0, (item.size ?? 0) - (item.sizeLeft ?? 0)),
        0,
      );
      return Math.max(0, Math.min(100, (totalDownloaded / totalSize) * 100));
    }
  }

  return null;
}

function summarizeLiveStatus(items: QueueItem[]): string | null {
  if (items.length === 0) {
    return null;
  }

  const uniqueStatuses = [...new Set(items.map((item) => item.status))];
  if (uniqueStatuses.length === 1) {
    return uniqueStatuses[0] ?? null;
  }

  return `${items.length} live downloads active`;
}

function summarizeLiveEta(items: QueueItem[]): {
  estimatedCompletionTime: string | null;
  timeLeft: string | null;
} {
  const itemsWithEstimate = items
    .map((item) => ({
      item,
      estimatedCompletionTimeMs: Date.parse(item.estimatedCompletionTime ?? ''),
    }))
    .filter((entry) => Number.isFinite(entry.estimatedCompletionTimeMs))
    .sort((left, right) => left.estimatedCompletionTimeMs - right.estimatedCompletionTimeMs);
  if (itemsWithEstimate.length > 0) {
    const earliestItem = itemsWithEstimate[0]?.item ?? null;
    if (earliestItem) {
      return {
        estimatedCompletionTime: earliestItem.estimatedCompletionTime,
        timeLeft: earliestItem.timeLeft,
      };
    }
  }

  const firstItemWithTimeLeft = items.find((item) => item.timeLeft);
  if (firstItemWithTimeLeft) {
    return {
      estimatedCompletionTime: firstItemWithTimeLeft.estimatedCompletionTime,
      timeLeft: firstItemWithTimeLeft.timeLeft,
    };
  }

  return {
    estimatedCompletionTime: null,
    timeLeft: null,
  };
}

export function buildManagedLiveSummary(liveQueueItems: QueueItem[]): ManagedQueueLiveSummary | null {
  if (liveQueueItems.length === 0) {
    return null;
  }

  const size = sumKnownMetric(liveQueueItems, (item) => item.size);
  const sizeLeft = sumKnownMetric(liveQueueItems, (item) => item.sizeLeft);
  const eta = summarizeLiveEta(liveQueueItems);

  return {
    rowCount: liveQueueItems.length,
    progress: summarizeLiveProgress(liveQueueItems),
    status: summarizeLiveStatus(liveQueueItems),
    timeLeft: eta.timeLeft,
    estimatedCompletionTime: eta.estimatedCompletionTime,
    size: size.value,
    sizeLeft: sizeLeft.value,
    byteMetricsPartial: size.partial || sizeLeft.partial,
  };
}
