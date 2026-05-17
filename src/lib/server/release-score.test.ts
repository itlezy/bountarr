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
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('b');
  });

  it('does not hard-reject releases without preferred audio evidence before download', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'uncertain',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [{ name: 'French' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('uncertain');
    expect(result.decision.reason).toContain('no clear English audio evidence');
  });

  it('uses the configured preferred audio language instead of hard-coded English', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'english',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'spanish',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.SPA-GROUP',
          languages: [{ name: 'Spanish' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        preferredLanguage: 'Spanish',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('spanish');
    expect(result.decision.reason).toContain('preferred audio Spanish metadata');
  });

  it('uses nested Arr language metadata when scoring preferred audio', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'english',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ language: { name: 'English' } }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'spanish',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.SPA-GROUP',
          languages: [{ language: { name: 'Spanish' } }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        preferredLanguage: 'Spanish',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('spanish');
    expect(result.decision.reason).toContain('preferred audio Spanish metadata');
  });

  it('auto-selects an Arr-rejected movie release when title and year match the target', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'unknown-movie',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Fixture.Movie.1999.1080p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Fixture Movie',
        targetYear: 1999,
      },
    );

    expect(result.decision.selected?.guid).toBe('unknown-movie');
    expect(result.decision.reason).toContain(
      'Bountarr title/year matched target for Arr rejection override',
    );
  });

  it('does not auto-select an Arr-rejected movie release when the year mismatches', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'wrong-year',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Fixture.Movie.2001.1080p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Fixture Movie',
        targetYear: 1999,
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toBe('No acceptable release passed the local scoring rules');
  });

  it('auto-selects an adjacent-year unknown-movie release when no exact-year release is acceptable', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'adjacent-year',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Fixture.Movie.1998.1080p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Fixture Movie',
        targetYear: 1999,
      },
    );

    expect(result.decision.selected?.guid).toBe('adjacent-year');
    expect(result.decision.reason).toContain(
      'Bountarr accepted adjacent release year because no exact-year match was available',
    );
  });

  it('prefers an exact-year release over an adjacent-year unknown-movie fallback', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'adjacent-year',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Fixture.Movie.1998.2160p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 150,
          releaseWeight: 150,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        },
        {
          guid: 'exact-year',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Fixture.Movie.1999.480p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 10,
          releaseWeight: 10,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Fixture Movie',
        targetYear: 1999,
      },
    );

    expect(result.decision.selected?.guid).toBe('exact-year');
    expect(result.decision.reason).not.toContain(
      'Bountarr accepted adjacent release year because no exact-year match was available',
    );
  });

  it('does not auto-select adjacent-year candidates when the title mismatches', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'wrong-title',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Different.Movie.1998.1080p.WEB-DL-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 70,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'usenet',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Fixture Movie',
        targetYear: 1999,
      },
    );

    expect(result.decision.selected).toBeNull();
  });

  it('uses accent-insensitive title hints for preferred audio', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'unknown',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'spanish-title',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ESPAÑOL-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        preferredLanguage: 'Spanish',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('spanish-title');
    expect(result.decision.reason).toContain('Spanish audio hint in title');
  });

  it('allows multi-language title evidence to outrank otherwise unknown audio', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'unknown',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'multi',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.MULTI-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('multi');
    expect(result.decision.reason).toContain('multi-language audio may include English');
  });

  it('recognizes punctuation-separated dual-audio title hints', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'unknown',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'dual-audio',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.DUAL.AUDIO-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('dual-audio');
    expect(result.decision.reason).toContain('multi-language audio may include English');
  });

  it('boosts subtitle evidence without requiring it before download', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'no-sub-hint',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'sub-hint',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG.SUBS-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('sub-hint');
    expect(result.decision.reason).toContain('subtitle hint in title');
  });

  it('uses nested subtitle metadata ahead of generic title hints', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'generic-subtitle-title',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG.SUBS-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'subtitle-metadata',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ name: 'English' }],
          subtitles: [{ language: { name: 'English' } }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('subtitle-metadata');
    expect(result.decision.reason).toContain('English subtitle metadata');
  });

  it('uses retry context to prefer stronger subtitle evidence after missing-subs', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'higher-weight-no-subs',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 160,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'lower-weight-subs',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG.SUBS-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        kind: 'movie',
        retryReasonCode: 'missing-subs',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('lower-weight-subs');
    expect(result.decision.reason).toContain('retry prefers English subtitle title hint');
  });

  it('uses retry context to prefer stronger audio evidence after missing-audio', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'higher-weight-unknown',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [],
          qualityWeight: 180,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'lower-weight-audio',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-GROUP',
          languages: [{ name: 'English' }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        retryReasonCode: 'missing-audio',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('lower-weight-audio');
    expect(result.decision.reason).toContain('retry prefers English audio metadata');
  });

  it('does not apply language retry penalties when preferences are Any', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'unknown',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL-GROUP',
          languages: [],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        preferredLanguage: 'Any',
        subtitleLanguage: 'Any',
      },
      {
        kind: 'movie',
        retryReasonCode: 'missing-subs',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('unknown');
    expect(result.decision.reason).not.toContain('retry penalty');
    expect(result.decision.reason).not.toContain('no clear');
  });

  it('penalizes releasers and indexers that already failed this acquisition', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'same-indexer-and-group',
          indexerId: 10,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG.SUBS-FAILEDGROUP',
          languages: [{ name: 'English' }],
          subtitles: [{ language: { name: 'English' } }],
          qualityWeight: 120,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: true,
        },
        {
          guid: 'fresh-indexer-and-group',
          indexerId: 11,
          indexer: 'Other Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG.SUBS-FRESHGROUP',
          languages: [{ name: 'English' }],
          subtitles: [{ language: { name: 'English' } }],
          qualityWeight: 80,
          releaseWeight: 40,
          customFormatScore: 0,
          size: 900,
          protocol: 'torrent',
          downloadAllowed: true,
        },
      ],
      {
        ...defaultPreferences,
        subtitleLanguage: 'English',
      },
      {
        failedIndexerIds: [10],
        failedReleasers: ['failedgroup'],
        kind: 'movie',
        retryReasonCode: 'missing-subs',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('fresh-indexer-and-group');
    expect(result.decision.reason).toContain('retry prefers English subtitle metadata');
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

  it('accepts existing-file Arr rejections for alternate grabs', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'replacement',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-FLUX',
          movieTitles: 'Movie',
          languages: [{ name: 'English' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Not an upgrade for existing movie file. Existing quality: WEBDL-1080p.'],
        },
      ],
      defaultPreferences,
      {
        kind: 'movie',
        targetTitle: 'Movie',
      },
    );

    expect(result.decision.selected?.guid).toBe('replacement');
    expect(result.decision.reason).toContain('Not an upgrade for existing movie file');
  });

  it('keeps unrelated Arr rejections out of automatic selection', () => {
    const result = selectBestRelease(
      [
        {
          guid: 'blocked',
          indexerId: 1,
          indexer: 'Indexer',
          title: 'Movie.2024.1080p.WEB-DL.ENG-FLUX',
          movieTitles: 'Movie',
          languages: [{ name: 'English' }],
          qualityWeight: 50,
          releaseWeight: 30,
          customFormatScore: 0,
          size: 1_000,
          protocol: 'torrent',
          downloadAllowed: false,
          rejected: true,
          rejections: ['Rejected by Arr custom format rules'],
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
          title: 'Fixture.Mistaken.1998.1080p.WEBRip.DD2.0.x264-NTb',
          movieTitles: 'Fixture Mistaken',
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
          title: 'Fixture.History.1998.HEVC.1080p.BluRay.DTS-HD.MA.5.1.x265-LEGi0N',
          movieTitles: 'Fixture History',
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
        targetTitle: 'Fixture History',
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
          title: 'Fixture.Mistaken.1998.1080p.WEBRip.DD2.0.x264-NTb',
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
        targetTitle: 'Fixture History',
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
          title: 'Fixture Series.S02.1080p.WEB-DL-FLUX',
          seriesTitles: 'Fixture Series',
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
          title: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Fixture Series',
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
        targetTitle: 'Fixture Series',
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
          title: 'Fixture Series.Complete.Series.1080p.WEB-DL-FLUX',
          seriesTitles: 'Fixture Series',
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
        targetTitle: 'Fixture Series',
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
          title: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Fixture Series',
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
        targetTitle: 'Fixture Series',
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
          title: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
          seriesTitles: 'Fixture Series',
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
        targetTitle: 'Fixture Series',
      },
    );

    expect(result.decision.selected).toBeNull();
    expect(result.decision.reason).toContain('No acceptable release');
  });
});
