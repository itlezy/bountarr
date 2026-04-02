import { describe, expect, it } from 'vitest';
import { itemMatchKeys } from '$lib/server/media-identity';
import {
  extractPlexPoster,
  itemMergeKeys,
  mergePlexResults,
  normalizePlexRecentSectionResult,
} from '$lib/server/plex-normalize';
import type { MediaItem } from '$lib/shared/types';

describe('extractPlexPoster', () => {
  it('builds an absolute Plex image URL with the auth token attached', () => {
    const poster = extractPlexPoster(
      {
        thumb: '/library/metadata/123/thumb/456',
      },
      'https://plex.example:32400',
      'secret-token',
    );

    expect(poster).toBe(
      'https://plex.example:32400/library/metadata/123/thumb/456?X-Plex-Token=secret-token',
    );
  });
});

describe('normalizePlexRecentSectionResult', () => {
  it('promotes recent Plex episodes into series cards with episode detail', () => {
    const item = normalizePlexRecentSectionResult(
      {
        type: 'episode',
        ratingKey: 'episode-1',
        grandparentRatingKey: 'show-1',
        title: 'Chapter One',
        grandparentTitle: 'Stranger Things',
        grandparentThumb: '/library/metadata/show-1/thumb/1',
        summary: 'Pilot',
        audienceRating: 7.7,
        year: 2016,
      },
      {
        key: '2',
        title: 'TV Shows',
        kind: 'series',
      },
      'https://plex.example:32400',
      'secret-token',
    );

    expect(item).toMatchObject({
      id: 'plex:series:show-1',
      kind: 'series',
      title: 'Stranger Things',
      rating: 7.7,
      detail: 'Chapter One',
      plexLibraries: ['TV Shows'],
      inPlex: true,
      sourceService: 'plex',
    });
    expect(item.poster).toBe(
      'https://plex.example:32400/library/metadata/show-1/thumb/1?X-Plex-Token=secret-token',
    );
  });
});

describe('mergePlexResults', () => {
  it('merges duplicate Plex items by provider ids and combines library names', () => {
    const first: MediaItem = {
      id: 'plex:movie:1',
      kind: 'movie',
      title: 'Dune',
      year: 2021,
      rating: 8.3,
      poster: null,
      overview: '',
      status: 'Already in Plex',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'plex',
      origin: 'plex',
      inArr: false,
      inPlex: true,
      plexLibraries: ['4K Movies'],
      canAdd: false,
      detail: null,
      requestPayload: {
        audienceRating: 8.3,
        Guid: [{ id: 'tmdb://438631' }],
      },
    };

    const second: MediaItem = {
      ...first,
      id: 'plex:movie:2',
      plexLibraries: ['Sci-Fi'],
      requestPayload: {
        Guid: [{ id: 'tmdb://438631' }],
      },
    };

    const merged = mergePlexResults([first, second]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.plexLibraries).toEqual(['4K Movies', 'Sci-Fi']);
  });
});

describe('Arr/Plex merge keys', () => {
  it('generate compatible provider-id keys for cross-provider matching', () => {
    const arrKeys = itemMatchKeys({
      id: 'movie:603',
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
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
        tmdbId: 603,
      },
    });

    const plexKeys = itemMergeKeys({
      id: 'plex:movie:603',
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      rating: null,
      poster: null,
      overview: '',
      status: 'Already in Plex',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'plex',
      origin: 'plex',
      inArr: false,
      inPlex: true,
      plexLibraries: ['Movies'],
      canAdd: false,
      detail: null,
      requestPayload: {
        Guid: [{ id: 'tmdb://603' }],
      },
    });

    expect(arrKeys).toContain('movie:tmdb:603');
    expect(plexKeys).toContain('movie:tmdb:603');
  });
});
