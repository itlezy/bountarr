import { describe, expect, it } from 'vitest';
import { describeAcquisitionTarget } from '$lib/shared/acquisition-scope';

describe('describeAcquisitionTarget', () => {
  it('describes series scope using seasons first', () => {
    expect(
      describeAcquisitionTarget({
        kind: 'series',
        targetEpisodeIds: [101, 102],
        targetSeasonNumbers: [1],
      }),
    ).toBe('Season 1');
  });

  it('falls back to episode count when seasons are unavailable', () => {
    expect(
      describeAcquisitionTarget({
        kind: 'series',
        targetEpisodeIds: [301, 302, 303],
        targetSeasonNumbers: null,
      }),
    ).toBe('3 episodes');
  });

  it('returns null for movie grabs', () => {
    expect(
      describeAcquisitionTarget({
        kind: 'movie',
        targetEpisodeIds: null,
        targetSeasonNumbers: null,
      }),
    ).toBeNull();
  });
});
