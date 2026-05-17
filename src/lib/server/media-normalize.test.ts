import { describe, expect, it } from 'vitest';
import { itemMatchKeys } from '$lib/server/media-identity';
import { mergeItems, normalizeItem, sortSearchResults } from '$lib/server/media-normalize';
import { defaultPreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

describe('normalizeItem', () => {
  it('normalizes tracked Arr media with media-info audit data', () => {
    const item = normalizeItem(
      'movie',
      {
        id: 42,
        title: 'Fixture Movie',
        year: 1999,
        monitored: true,
        ratings: {
          tmdb: {
            value: 8.7,
          },
        },
        images: [{ coverType: 'poster', remoteUrl: 'https://img.example/Fixture.jpg' }],
        mediaInfo: {
          audioLanguages: [{ name: 'English' }],
          subtitles: [{ name: 'English' }],
        },
      },
      defaultPreferences,
    );

    expect(item).toMatchObject({
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      rating: 8.7,
      poster: 'https://img.example/Fixture.jpg',
      status: 'Monitored',
      auditStatus: 'verified',
      inArr: true,
      inPlex: false,
      canAdd: false,
      sourceService: 'radarr',
    });
    expect(item.audioLanguages).toEqual(['English']);
    expect(item.subtitleLanguages).toEqual(['English']);
  });
});

describe('mergeItems', () => {
  it('merges Arr and Plex items into one combined result', () => {
    const arrItem = normalizeItem(
      'movie',
      {
        id: 42,
        title: 'Fixture Movie',
        year: 1999,
        monitored: true,
        tmdbId: 603,
        mediaInfo: {
          audioLanguages: [{ name: 'English' }],
          subtitles: [{ name: 'English' }],
        },
      },
      defaultPreferences,
      {
        id: 'movie:42',
      },
    );

    const plexItem: MediaItem = {
      id: 'plex:movie:603',
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      rating: 8.7,
      poster: 'https://plex.example/poster.jpg',
      overview: 'Plex copy',
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
        Guid: [{ id: 'tmdb://603' }],
      },
    };

    const merged = mergeItems(arrItem, plexItem);

    expect(merged.origin).toBe('merged');
    expect(merged.inArr).toBe(true);
    expect(merged.inPlex).toBe(true);
    expect(merged.status).toBe('Monitored');
    expect(merged.sourceService).toBe('radarr');
    expect(merged.plexLibraries).toEqual(['4K Movies']);
    expect(merged.rating).toBe(8.7);
  });
});

describe('itemMatchKeys', () => {
  it('includes stable provider ids for Arr results so Plex matches can merge cleanly', () => {
    const keys = itemMatchKeys({
      id: 'movie:42',
      kind: 'movie',
      title: 'Fixture Movie',
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

    expect(keys).toContain('movie:tmdb:603');
    expect(keys).toContain('movie:fixture movie:1999');
  });

  it('includes alternate-title and numeral-equivalent keys for title fallback matching', () => {
    const keys = itemMatchKeys({
      id: 'movie:1370',
      kind: 'movie',
      title: 'Fixture Action III',
      year: 1988,
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
        alternateTitles: [{ title: 'Fixture Action 3' }],
      },
    });

    expect(keys).toContain('movie:fixture action iii:1988');
    expect(keys).toContain('movie:fixture action 3:1988');
  });
});

describe('sortSearchResults', () => {
  function searchItem(title: string, year: number, popularity = 0): MediaItem {
    return {
      id: `series:${title}`,
      kind: 'series',
      title,
      year,
      rating: null,
      poster: null,
      overview: '',
      status: 'Ready to add',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'sonarr',
      origin: 'arr',
      inArr: false,
      inPlex: false,
      plexLibraries: [],
      canAdd: true,
      detail: null,
      requestPayload: {
        popularity,
      },
    };
  }

  it('prefers article-stripped exact title matches over newer series variants', () => {
    const results = sortSearchResults('fixture workplace', [
      searchItem('The Fixture Workplace (AU)', 2024, 500),
      searchItem('Workplace Joe', 2024, 900),
      searchItem('The Fixture Workplace', 2001, 50),
    ]);

    expect(results.map((item) => item.title)).toEqual([
      'The Fixture Workplace',
      'The Fixture Workplace (AU)',
      'Workplace Joe',
    ]);
  });

  it('prefers exact title matches over newer prefix matches', () => {
    const results = sortSearchResults('Fixture Movie', [
      searchItem('Fixture Variant', 2025, 1000),
      searchItem('Fixture Movie', 1999, 10),
    ]);

    expect(results.map((item) => item.title)).toEqual(['Fixture Movie', 'Fixture Variant']);
  });

  it('prefers exact tracked series matches over addable fuzzy matches', () => {
    const exactTracked = {
      ...searchItem('Fixture Series', 2022, 10),
      inArr: true,
      canAdd: false,
      status: 'Monitored',
      isExisting: true,
      isRequested: true,
    };
    const fuzzyAddable = searchItem(
      'Does It Count If You Lose Your Innocence to an Android?',
      2026,
      900,
    );

    const results = sortSearchResults('Fixture Series', [fuzzyAddable, exactTracked]);

    expect(results.map((item) => item.title)).toEqual([
      'Fixture Series',
      'Does It Count If You Lose Your Innocence to an Android?',
    ]);
  });
});
