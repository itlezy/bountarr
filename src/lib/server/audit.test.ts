import { describe, expect, it } from 'vitest';
import { evaluateAudit } from '$lib/server/audit';
import { defaultPreferences } from '$lib/shared/preferences';

describe('evaluateAudit', () => {
  it('returns verified when preferred language and subtitles are present', () => {
    expect(evaluateAudit(['eng'], ['eng'], defaultPreferences, true)).toBe('verified');
  });

  it('returns missing-language when the preferred audio language is absent', () => {
    expect(evaluateAudit(['jpn'], ['eng'], defaultPreferences, true)).toBe('missing-language');
  });

  it('returns no-subs when subtitles are required but absent', () => {
    expect(
      evaluateAudit(['english'], [], { ...defaultPreferences, subtitleLanguage: 'English' }, true),
    ).toBe('no-subs');
  });

  it('returns no-subs when the configured subtitle language is absent', () => {
    expect(
      evaluateAudit(
        ['english'],
        ['Spanish'],
        { ...defaultPreferences, subtitleLanguage: 'German' },
        true,
      ),
    ).toBe('no-subs');
  });

  it('returns verified when subtitle language is Any', () => {
    expect(
      evaluateAudit(['english'], [], { ...defaultPreferences, subtitleLanguage: 'Any' }, true),
    ).toBe('verified');
  });

  it('returns unknown when media info is missing', () => {
    expect(evaluateAudit([], [], defaultPreferences, false)).toBe('unknown');
  });
});
