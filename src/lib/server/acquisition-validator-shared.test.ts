import { describe, expect, it } from 'vitest';
import {
  findQueueRecordForArrItem,
  queueRecordArrItemId,
  queueRecordId,
} from '$lib/server/acquisition-validator-shared';

describe('acquisition validator shared helpers', () => {
  it('matches Radarr queue rows using top-level or nested movie ids', () => {
    const topLevelRecord = {
      id: 11,
      movieId: 603,
    };
    const nestedRecord = {
      id: 12,
      movie: {
        id: 604,
      },
    };

    expect(queueRecordArrItemId('radarr', topLevelRecord)).toBe(603);
    expect(queueRecordArrItemId('radarr', nestedRecord)).toBe(604);
    expect(findQueueRecordForArrItem([topLevelRecord, nestedRecord], 'radarr', 603)).toBe(
      topLevelRecord,
    );
    expect(queueRecordId(topLevelRecord)).toBe(11);
  });

  it('matches Sonarr queue rows using top-level or nested series ids', () => {
    const topLevelRecord = {
      id: 21,
      seriesId: 701,
    };
    const nestedRecord = {
      id: 22,
      series: {
        id: 702,
      },
    };

    expect(queueRecordArrItemId('sonarr', topLevelRecord)).toBe(701);
    expect(queueRecordArrItemId('sonarr', nestedRecord)).toBe(702);
    expect(findQueueRecordForArrItem([topLevelRecord, nestedRecord], 'sonarr', 702)).toBe(
      nestedRecord,
    );
    expect(queueRecordId(nestedRecord)).toBe(22);
  });
});
