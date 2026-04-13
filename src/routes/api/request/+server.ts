import { error, json } from '@sveltejs/kit';
import { requestItem } from '$lib/server/acquisition-service';
import { isAcquisitionRequestError } from '$lib/server/acquisition-domain';
import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { ThemeMode } from '$lib/shared/themes';
import type { MediaItem } from '$lib/shared/types';

const logger = createAreaLogger('api.request');

function sanitizeSeasonNumbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [...new Set(
    value
      .filter(
        (seasonNumber) =>
          typeof seasonNumber === 'number' &&
          Number.isFinite(seasonNumber) &&
          seasonNumber >= 0,
      )
      .map((seasonNumber) => Math.trunc(seasonNumber)),
  )].sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : undefined;
}

export const POST = async ({ request }) => {
  const payload = (await request.json()) as {
    item?: MediaItem;
    qualityProfileId?: number;
    seasonNumbers?: number[];
    preferences?: {
      preferredLanguage?: string;
      subtitleLanguage?: string;
      theme?: ThemeMode;
    };
  };
  const preferences = sanitizePreferences(payload.preferences);

  logger.info('Request API call started', {
    title: payload.item?.title ?? null,
    kind: payload.item?.kind ?? null,
    preferredLanguage: preferences.preferredLanguage,
    subtitleLanguage: preferences.subtitleLanguage,
  });

  if (!payload.item) {
    logger.warn('Request API call rejected because no media item was provided');
    throw error(400, 'A media item is required.');
  }

  try {
    const result = await requestItem(payload.item, preferences, {
      qualityProfileId:
        typeof payload.qualityProfileId === 'number' && Number.isFinite(payload.qualityProfileId)
          ? payload.qualityProfileId
          : undefined,
      seasonNumbers: sanitizeSeasonNumbers(payload.seasonNumbers),
    });
    logger.info('Request API call completed', {
      title: payload.item.title,
      existing: result.existing,
      jobId: result.job?.id ?? null,
    });
    return json(result);
  } catch (requestError) {
    const message = getErrorMessage(requestError, 'Unable to add the selected item.');
    const status = isAcquisitionRequestError(requestError) ? requestError.status : 500;
    logger.error('Request API call failed', {
      title: payload.item.title,
      ...toErrorLogContext(requestError),
    });

    return new Response(message, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
};
