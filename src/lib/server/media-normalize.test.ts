import { describe, expect, it } from 'vitest';
import { itemMatchKeys } from '$lib/server/media-identity';
import { mergeItems, normalizeItem } from '$lib/server/media-normalize';
import { defaultPreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

describe('normalizeItem', () => {
  it('normalizes tracked Arr media with media-info audit data', () => {
    const item = normalizeItem(
      'movie',
      {
        id: 42,
        title: 'The Matrix',
        year: 1999,
        monitored: true,
        ratings: {
          tmdb: {
            value: 8.7,
          },
        },
        images: [{ coverType: 'poster', remoteUrl: 'https://img.example/matrix.jpg' }],
        mediaInfo: {
          audioLanguages: [{ name: 'English' }],
          subtitles: [{ name: 'English' }],
        },
      },
      defaultPreferences,
    );

    expect(item).toMatchObject({
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      rating: 8.7,
      poster: 'https://img.example/matrix.jpg',
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
        title: 'The Matrix',
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
      title: 'The Matrix',
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

    expect(keys).toContain('movie:tmdb:603');
    expect(keys).toContain('movie:the matrix:1999');
  });

  it('includes alternate-title and numeral-equivalent keys for title fallback matching', () => {
    const keys = itemMatchKeys({
      id: 'movie:1370',
      kind: 'movie',
      title: 'Rambo III',
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
        alternateTitles: [{ title: 'Rambo 3' }],
      },
    });

    expect(keys).toContain('movie:rambo iii:1988');
    expect(keys).toContain('movie:rambo 3:1988');
  });
});
