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
          downloadAllowed: true,
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
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
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
          downloadAllowed: true,
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
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
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
          downloadAllowed: false,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });

  it('returns a non-fatal empty result when nothing is available', () => {
    const result = selectBestRelease([], defaultPreferences, {
      kind: 'movie',
      targetTitle: 'Movie',
    });

    expect(result.decision.selected).toBeNull();
    expect(result.decision.considered).toBe(0);
    expect(result.decision.reason).toContain('No manual-search releases');
  });

  it('uses size as the tie-breaker when scores match', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'a',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUPA',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'b',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUPB',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 2_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('b');
  });

  it('boosts the proven releaser from previous successful grabs', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'a',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-OTHER',
          languages: [{ name: 'English' }],
          qualityWeight: 90,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 2_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'b',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-FLUX',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        preferredReleaser: 'FLUX',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('b');
    expect(result.decision.reason).toContain('matched proven releaser FLUX');
  });

  it('rejects structured title mismatches before local scoring picks a winner', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'wrong',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Who.Am.I.1998.1080p.WEBRip.DD2.0.x264-NTb',
          movieTitles: 'Who Am I',
          languages: [{ name: 'English' }],
          qualityWeight: 1701,
          releaseWeight: 220,
          customFormatScore: 3,
          size: 7_000_000_000,
          protocol: 'usenet',
          downloadAllowed: true,
        },
        {
          guid: 'correct',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'American.History.X.1998.HEVC.1080p.BluRay.DTS-HD.MA.5.1.x265-LEGi0N',
          movieTitles: 'American History X',
          languages: [{ name: 'English' }],
          qualityWeight: 1701,
          releaseWeight: 180,
          customFormatScore: 0,
          size: 8_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        preferredReleaser: 'NTB',
        targetTitle: 'American History X',
      },
    );

    expect(result.decision.selected?.guid).toBe('correct');
  });

  it('marks sparse release titles as mismatches when the parsed title points elsewhere', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'wrong',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Who.Am.I.1998.1080p.WEBRip.DD2.0.x264-NTb',
          languages: [{ name: 'English' }],
          qualityWeight: 1701,
          releaseWeight: 220,
          customFormatScore: 3,
          size: 7_000_000_000,
          protocol: 'usenet',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'American History X',
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });

  it('keeps out-of-scope series seasons out of automatic selection', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'wrong-season',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Andor.S02.1080p.WEB-DL-FLUX',
          seriesTitles: 'Andor',
          languages: [{ name: 'English' }],
          qualityWeight: 100,
          releaseWeight: 80,
          customFormatScore: 0,
          size: 8_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'target-season',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Andor.S01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Andor',
          languages: [{ name: 'English' }],
          qualityWeight: 100,
          releaseWeight: 70,
          customFormatScore: 0,
          size: 7_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'series',
        targetSeasonNumbers: [1],
        targetTitle: 'Andor',
      },
    );

    expect(result.decision.selected?.guid).toBe('target-season');
  });

  it('rejects complete-series packs for season-limited grabs', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'complete-series',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Andor.Complete.Series.1080p.WEB-DL-FLUX',
          seriesTitles: 'Andor',
          languages: [{ name: 'English' }],
          qualityWeight: 140,
          releaseWeight: 80,
          customFormatScore: 0,
          size: 20_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'series',
        targetSeasonNumbers: [1],
        targetTitle: 'Andor',
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });

  it('accepts season-matching releases that cover more known episodes than the stale target snapshot', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'season-pack',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Andor.S01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Andor',
          episodeIds: [101, 102, 103],
          seasonNumbers: [1],
          languages: [{ name: 'English' }],
          qualityWeight: 120,
          releaseWeight: 80,
          customFormatScore: 0,
          size: 12_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'series',
        targetEpisodeIds: [101, 102],
        targetSeasonNumbers: [1],
        targetTitle: 'Andor',
      },
    );

    expect(result.decision.selected?.guid).toBe('season-pack');
  });

  it('keeps single-episode releases out of automatic selection for season-limited grabs', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'single-episode',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Andor',
          episodeIds: [101],
          seasonNumbers: [1],
          languages: [{ name: 'English' }],
          qualityWeight: 140,
          releaseWeight: 90,
          customFormatScore: 0,
          size: 4_000_000_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'series',
        targetEpisodeIds: [101, 102],
        targetSeasonNumbers: [1],
        targetTitle: 'Andor',
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });
});
