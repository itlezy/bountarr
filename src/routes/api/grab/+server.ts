import { error, json } from '@sveltejs/kit';
import { isAcquisitionGrabError } from '$lib/server/acquisition-domain';
import { readJsonRecord } from '$lib/server/api-request';
import { grabItem } from '$lib/server/acquisition-service';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import { asRecord, asString } from '$lib/server/raw';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { MediaItem } from '$lib/shared/types';

const logger = createAreaLogger('api.grab');

function mediaItemFromPayload(value: unknown): MediaItem | null {
  const item = asRecord(value);
  const kind = item.kind === 'movie' || item.kind === 'series' ? item.kind : null;
  const sourceService =
    item.sourceService === 'plex' ||
    item.sourceService === 'radarr' ||
    item.sourceService === 'sonarr'
      ? item.sourceService
      : null;

  return kind && sourceService && asString(item.id) && asString(item.title)
    ? (value as MediaItem)
    : null;
}

function sanitizeSeasonNumbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      value
        .filter(
          (seasonNumber) =>
            typeof seasonNumber === 'number' && Number.isFinite(seasonNumber) && seasonNumber >= 0,
        )
        .map((seasonNumber) => Math.trunc(seasonNumber)),
    ),
  ].sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : undefined;
}

export const POST = async ({ request }) => {
  const payload = await readJsonRecord(request);
  const item = mediaItemFromPayload(payload.item);
  const seasonNumbers = sanitizeSeasonNumbers(payload.seasonNumbers);
  const preferences = sanitizePreferences(asRecord(payload.preferences));

  logger.info('Grab API call started', {
    title: item?.title ?? null,
    kind: item?.kind ?? null,
    preferredLanguage: preferences.preferredLanguage,
    subtitleLanguage: preferences.subtitleLanguage,
  });

  if (!item) {
    logger.warn('Grab API call rejected because no media item was provided');
    throw error(400, 'A media item is required.');
  }

  if (item.kind === 'series' && !seasonNumbers) {
    logger.warn('Grab API call rejected because no season scope was provided for a series', {
      title: item.title,
    });
    throw error(400, 'Select at least one season before grabbing a series.');
  }

  try {
    const result = await grabItem(item, preferences, {
      qualityProfileId:
        typeof payload.qualityProfileId === 'number' && Number.isFinite(payload.qualityProfileId)
          ? payload.qualityProfileId
          : undefined,
      seasonNumbers,
    });
    logger.info('Grab API call completed', {
      title: item.title,
      existing: result.existing,
      jobId: result.job?.id ?? null,
    });
    return json(result);
  } catch (grabError) {
    const message = getErrorMessage(grabError, 'Unable to grab the selected item.');
    const status = isAcquisitionGrabError(grabError) ? grabError.status : 500;
    logger.error('Grab API call failed', {
      title: item.title,
      ...toErrorLogContext(grabError),
    });

    return new Response(message, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
};
