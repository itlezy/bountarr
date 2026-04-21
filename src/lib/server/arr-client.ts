import { env } from '$env/dynamic/private';
import { createAreaLogger, getErrorMessage } from '$lib/server/logger';
import type { ArrService } from '$lib/server/acquisition-domain';

type ServiceConfig = {
  apiKey: string;
  baseUrl: string;
};

const logger = createAreaLogger('arr-client');
export type ArrFetchErrorKind = 'config' | 'invalid-json' | 'network' | 'response';

type ArrFetchErrorOptions = {
  body?: string | null;
  kind: ArrFetchErrorKind;
  message: string;
  path: string;
  service: ArrService;
  status?: number | null;
  statusText?: string | null;
};

export class ArrFetchError extends Error {
  readonly body: string | null;
  readonly kind: ArrFetchErrorKind;
  readonly path: string;
  readonly service: ArrService;
  readonly status: number | null;
  readonly statusText: string | null;

  constructor(options: ArrFetchErrorOptions) {
    super(options.message);
    this.name = 'ArrFetchError';
    this.body = options.body ?? null;
    this.kind = options.kind;
    this.path = options.path;
    this.service = options.service;
    this.status = options.status ?? null;
    this.statusText = options.statusText ?? null;
  }
}

export function isArrFetchError(error: unknown): error is ArrFetchError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as {
    kind?: unknown;
    path?: unknown;
    service?: unknown;
  };

  return (
    error instanceof ArrFetchError ||
    (error.name === 'ArrFetchError' &&
      ['config', 'invalid-json', 'network', 'response'].includes(String(candidate.kind)) &&
      typeof candidate.path === 'string' &&
      (candidate.service === 'radarr' || candidate.service === 'sonarr'))
  );
}

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

function ensureConfigured(service: ArrService, requestPath: string): ServiceConfig {
  const config = getServiceConfig(service);

  if (!config) {
    throw new ArrFetchError({
      kind: 'config',
      message: `${service} is not configured`,
      path: requestPath,
      service,
    });
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
  const config = ensureConfigured(service, requestPath);
  const url = new URL(`${config.baseUrl}${requestPath}`);
  const method = init?.method ?? 'GET';

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

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'network error');
    logger.error('Arr request failed', {
      error: message,
      method,
      path: requestPath,
      service,
    });
    throw new ArrFetchError({
      kind: 'network',
      message: `${service} request failed: ${message}`,
      path: requestPath,
      service,
    });
  }

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
    throw new ArrFetchError({
      body: errorBody || response.statusText,
      kind: 'response',
      message: `${service} ${response.status}: ${errorBody || response.statusText}`,
      path: requestPath,
      service,
      status: response.status,
      statusText: response.statusText,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = getErrorMessage(error, 'invalid JSON');
    logger.error('Arr response was not valid JSON', {
      body: truncateLogText(text),
      error: message,
      method,
      path: requestPath,
      service,
    });
    throw new ArrFetchError({
      body: text,
      kind: 'invalid-json',
      message: `${service} returned invalid JSON from ${requestPath}: ${message}`,
      path: requestPath,
      service,
    });
  }
}
