import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findQueueRecordForArrItem,
  queueRecordArrItemId,
  queueRecordId,
} from '$lib/server/acquisition-validator-shared';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

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

  it('paginates Arr queue lookups until the matching record is found', async () => {
    vi.resetModules();
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 1,
        records: [{ id: 11, movieId: 100 }],
        totalRecords: 2,
      })
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 1,
        records: [{ id: 12, movieId: 603 }],
        totalRecords: 2,
      });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));

    const module = await import('$lib/server/acquisition-validator-shared');
    const records = await module.fetchQueueRecords('radarr');

    expect(arrFetch).toHaveBeenCalledTimes(2);
    expect(module.findQueueRecordForArrItem(records, 'radarr', 603)).toEqual({
      id: 12,
      movieId: 603,
    });
  });

  it('paginates Arr history lookups using top-level or nested item ids', async () => {
    vi.resetModules();
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 1,
        records: [{ id: 31, movieId: 100, date: '2026-04-13T12:00:00.000Z' }],
        totalRecords: 2,
      })
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 1,
        records: [{ id: 32, movie: { id: 603 }, date: '2026-04-13T12:01:00.000Z' }],
        totalRecords: 2,
      });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));

    const module = await import('$lib/server/acquisition-validator-shared');
    const records = await module.fetchHistoryRecords('radarr', 603);

    expect(arrFetch).toHaveBeenCalledTimes(2);
    expect(records).toEqual([{ id: 32, movie: { id: 603 }, date: '2026-04-13T12:01:00.000Z' }]);
  });
});
