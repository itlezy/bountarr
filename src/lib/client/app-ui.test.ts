import { describe, expect, it } from 'vitest';
import { actionLabel, formatBytes } from './app-ui';

describe('formatBytes', () => {
  it('formats zero-byte values explicitly', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('keeps positive-byte formatting unchanged', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('rejects negative and non-finite values', () => {
    expect(formatBytes(-1)).toBe('Unknown');
    expect(formatBytes(Number.NaN)).toBe('Unknown');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('Unknown');
  });
});

describe('actionLabel', () => {
  it('uses Grab Again for tracked Arr items that can start an alternate-release flow', () => {
    expect(
      actionLabel(
        {
          id: 'movie:603',
          arrItemId: 603,
          kind: 'movie',
          title: 'The Matrix',
          year: 1999,
          rating: null,
          poster: null,
          overview: '',
          status: 'Already in Arr',
          isExisting: true,
          isRequested: true,
          auditStatus: 'pending',
          audioLanguages: [],
          subtitleLanguages: [],
          sourceService: 'radarr',
          origin: 'arr',
          inArr: true,
          inPlex: false,
          plexLibraries: [],
          canAdd: false,
          detail: null,
          requestPayload: {
            id: 603,
            tmdbId: 603,
          },
        },
        null,
      ),
    ).toBe('Grab Again');
  });

  it('keeps Grab for new titles that are ready to add', () => {
    expect(
      actionLabel(
        {
          id: 'movie:604',
          arrItemId: null,
          kind: 'movie',
          title: 'New Title',
          year: 2026,
          rating: null,
          poster: null,
          overview: '',
          status: 'Ready to add',
          isExisting: false,
          isRequested: false,
          auditStatus: 'pending',
          audioLanguages: [],
          subtitleLanguages: [],
          sourceService: 'radarr',
          origin: 'arr',
          inArr: false,
          inPlex: false,
          plexLibraries: [],
          canAdd: true,
          detail: null,
          requestPayload: {
            id: 604,
            tmdbId: 604,
          },
        },
        null,
      ),
    ).toBe('Grab');
  });
});
