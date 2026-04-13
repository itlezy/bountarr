import { describe, expect, it } from 'vitest';
import {
  acquisitionAttemptSummary,
  acquisitionNextStep,
  acquisitionReasonSummary,
  actionDisabled,
  actionLabel,
  canGrabWithPlexConfirmation,
  grabFeedbackMessage,
  plexConfirmedGrabItem,
} from '$lib/client/app-ui';
import type { AcquisitionJob, GrabResponse, MediaItem } from '$lib/shared/types';

const baseJob: AcquisitionJob = {
  id: 'job-1',
  itemId: 'movie:603',
  arrItemId: 603,
  kind: 'movie',
  title: 'The Matrix',
  sourceService: 'radarr',
  status: 'retrying',
  attempt: 2,
  maxRetries: 4,
  currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
  selectedReleaser: 'flux',
  preferredReleaser: 'flux',
  reasonCode: 'missing-subs',
  failureReason: 'Imported file is missing the selected subtitle language.',
  validationSummary: 'Imported file is missing the selected subtitle language.',
  autoRetrying: true,
  progress: 100,
  queueStatus: 'Imported',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  startedAt: '2026-04-02T12:00:00.000Z',
  updatedAt: '2026-04-02T12:05:00.000Z',
  completedAt: null,
  attempts: [
    {
      attempt: 1,
      status: 'retrying',
      reasonCode: 'missing-subs',
      releaseTitle: 'The.Matrix.1999.1080p.WEB-DL-GROUPA',
      releaser: 'groupa',
      reason: 'Imported file is missing the selected subtitle language.',
      startedAt: '2026-04-02T12:00:00.000Z',
      finishedAt: '2026-04-02T12:03:00.000Z',
    },
  ],
};

describe('app-ui acquisition helpers', () => {
  it('explains retrying jobs in household-friendly terms', () => {
    const attempt = baseJob.attempts[0];
    if (!attempt) {
      throw new Error('Expected acquisition attempt fixture');
    }

    expect(acquisitionReasonSummary(baseJob)).toBe('Missing selected subtitles');
    expect(acquisitionNextStep(baseJob)).toBe('Trying another option automatically.');
    expect(acquisitionAttemptSummary(attempt)).toBe(
      'Trying another option · Missing selected subtitles',
    );
  });

  it('formats grab feedback from the normalized acquisition reason', () => {
    const response: GrabResponse = {
      existing: false,
      item: {
        id: 'movie:603',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        rating: 8.7,
        poster: null,
        overview: 'Sci-fi',
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
        requestPayload: { tmdbId: 603 },
      },
      message: 'Queued',
      releaseDecision: null,
      job: baseJob,
    };

    expect(grabFeedbackMessage(response)).toBe(
      'Trying another option · attempt 2/4 · Missing selected subtitles',
    );
  });

  it('allows a Plex-confirmed grab when a merged Plex result still has Arr request context', () => {
    const item: MediaItem = {
      id: 'movie:603',
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      rating: 8.7,
      poster: null,
      overview: 'Sci-fi',
      status: 'Available in Plex',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'plex',
      origin: 'merged',
      inArr: false,
      inPlex: true,
      plexLibraries: ['Movies'],
      canAdd: false,
      detail: null,
      requestPayload: { tmdbId: 603 },
    };

    expect(canGrabWithPlexConfirmation(item)).toBe(true);
    expect(plexConfirmedGrabItem(item)).toMatchObject({
      canAdd: true,
      sourceService: 'radarr',
      origin: 'arr',
    });
    expect(actionLabel(item, null)).toBe('Grab');
    expect(actionDisabled(item, null)).toBe(false);
  });
});
