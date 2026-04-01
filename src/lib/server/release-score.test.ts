import { describe, expect, it } from 'vitest';
import { defaultPreferences } from '$lib/shared/preferences';
import { selectBestRelease } from '$lib/server/release-score';

describe('selectBestRelease', () => {
  it('prefers preferred-language releases', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'a',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.MULTI',
          languages: [{ name: 'French' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true
        },
        {
          guid: 'b',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.ENG.MULTI',
          languages: [{ name: 'English' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true
        }
      ],
      defaultPreferences,
      {
        kind: 'movie'
      }
    );

    expect(result.decision.selected?.guid).toBe('b');
  });

  it('rejects blocked releasers and source patterns', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'a',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-YTS',
          languages: [{ name: 'English' }],
          qualityWeight: 90,
          releaseWeight: 90,
          customFormatScore: 20,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true
        },
        {
          guid: 'b',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-FLUX',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 80,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true
        }
      ],
      defaultPreferences,
      {
        kind: 'movie'
      }
    );

    expect(result.decision.selected?.guid).toBe('b');
  });

  it('rejects releases Arr marked as unavailable', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'a',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.ENG',
          languages: [{ name: 'English' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: false
        }
      ],
      defaultPreferences,
      {
        kind: 'movie'
      }
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });

  it('returns a non-fatal empty result when nothing is available', () => {
    const result = selectBestRelease([], defaultPreferences, {
      kind: 'movie'
    });

    expect(result.decision.selected).toBeNull();
    expect(result.decision.considered).toBe(0);
    expect(result.decision.reason).toContain('No manual-search releases');
  });
});
