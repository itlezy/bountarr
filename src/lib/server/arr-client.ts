import { env } from '$env/dynamic/private';
import { createAreaLogger } from '$lib/server/logger';
import type { ArrService } from '$lib/server/acquisition-domain';

type ServiceConfig = {
  apiKey: string;
  baseUrl: string;
};

const logger = createAreaLogger('arr-client');

function truncateLogText(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function getServiceConfig(service: ArrService): ServiceConfig | null {
  const baseUrl = (service === 'radarr' ? env.RADARR_URL : env.SONARR_URL)?.trim();
  const apiKey = (service === 'radarr' ? env.RADARR_API_KEY : env.SONARR_API_KEY)?.trim();

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
  };
}

function ensureConfigured(service: ArrService): ServiceConfig {
  const config = getServiceConfig(service);

  if (!config) {
    throw new Error(`${service} is not configured`);
  }

  return config;
}

export function qualityProfileName(service: ArrService): string | null {
  const value =
    service === 'radarr'
      ? env.RADARR_QUALITY_PROFILE_NAME?.trim()
      : env.SONARR_QUALITY_PROFILE_NAME?.trim();

  return value && value.length > 0 ? value : null;
}

export function acquisitionAttemptTimeoutMinutes(): number {
  const value = Number(env.ACQUISITION_ATTEMPT_TIMEOUT_MINUTES ?? '90');
  return Number.isFinite(value) && value > 0 ? value : 90;
}

export function acquisitionMaxRetries(): number {
  const value = Number(env.ACQUISITION_MAX_RETRIES ?? '4');
  return Number.isFinite(value) && value > 0 ? value : 4;
}

export function acquisitionPollMs(): number {
  return 15_000;
}

export async function arrFetch<T>(
  service: ArrService,
  requestPath: string,
  init?: RequestInit,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const config = ensureConfigured(service);
  const url = new URL(`${config.baseUrl}${requestPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = new Headers(init?.headers);
  headers.set('X-Api-Key', config.apiKey);

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Arr request failed', {
      service,
      path: requestPath,
      method: init?.method ?? 'GET',
      status: response.status,
      statusText: response.statusText,
      body: truncateLogText(errorBody || response.statusText),
    });
    throw new Error(`${service} ${response.status}: ${errorBody || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
