import { env } from '$env/dynamic/private';
import { existsSync, statSync, statfsSync } from 'node:fs';
import { freemem, hostname, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { defaultAcquisitionDatabasePath, getAcquisitionDatabase } from '$lib/server/acquisition-db';
import { LOG_FILE_PATH, createAreaLogger } from '$lib/server/logger';
import type { RuntimeHealth } from '$lib/shared/types';

export interface ServiceConfigurationFlags {
  radarrConfigured: boolean;
  sonarrConfigured: boolean;
  plexConfigured: boolean;
  configured: boolean;
}

const logger = createAreaLogger('runtime');
const validLogLevels = new Set(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']);
const dataPath = 'data';
let bootLogged = false;

type StorageMetrics = Pick<RuntimeHealth, 'storagePath' | 'freeSpaceBytes' | 'totalSpaceBytes'>;
type DatabaseMetrics = Pick<
  RuntimeHealth,
  | 'databasePath'
  | 'databaseSizeBytes'
  | 'databaseJobCount'
  | 'databaseAttemptCount'
  | 'databaseEventCount'
>;

function trimEnv(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function collectPairIssues(
  issues: string[],
  warnings: string[],
  name: string,
  urlValue: string | null,
  secretValue: string | null,
  required: boolean,
): void {
  const messages = required ? issues : warnings;

  if (urlValue && !secretValue) {
    messages.push(`${name} requires both URL and API credentials to be set together.`);
  }

  if (!urlValue && secretValue) {
    messages.push(`${name} requires both URL and API credentials to be set together.`);
  }
}

function resolveExistingPath(targetPath: string): string {
  let currentPath = resolve(targetPath);

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return resolve(targetPath);
    }

    currentPath = parentPath;
  }

  return currentPath;
}

function getStorageMetrics(targetPath: string): StorageMetrics {
  const storagePath = resolveExistingPath(targetPath);

  try {
    const stats = statfsSync(storagePath);
    const freeBlocks = Number(stats.bavail ?? stats.bfree);
    const totalBlocks = Number(stats.blocks);
    const blockSize = Number(stats.bsize);

    if (
      !Number.isFinite(freeBlocks) ||
      !Number.isFinite(totalBlocks) ||
      !Number.isFinite(blockSize)
    ) {
      return {
        storagePath,
        freeSpaceBytes: null,
        totalSpaceBytes: null,
      };
    }

    return {
      storagePath,
      freeSpaceBytes: Math.max(0, freeBlocks * blockSize),
      totalSpaceBytes: Math.max(0, totalBlocks * blockSize),
    };
  } catch {
    return {
      storagePath,
      freeSpaceBytes: null,
      totalSpaceBytes: null,
    };
  }
}

function getDatabaseMetrics(): DatabaseMetrics {
  const fallbackPath = defaultAcquisitionDatabasePath();

  try {
    const acquisitionDatabase = getAcquisitionDatabase();
    const databasePath = acquisitionDatabase.databasePath;
    const countRow = acquisitionDatabase.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM acquisition_jobs) AS job_count,
          (SELECT COUNT(*) FROM acquisition_attempts) AS attempt_count,
          (SELECT COUNT(*) FROM acquisition_events) AS event_count`,
      )
      .get() as {
      job_count: number;
      attempt_count: number;
      event_count: number;
    };

    return {
      databasePath,
      databaseSizeBytes:
        acquisitionDatabase.ownsDatabase && existsSync(databasePath)
          ? statSync(databasePath).size
          : null,
      databaseJobCount: countRow.job_count,
      databaseAttemptCount: countRow.attempt_count,
      databaseEventCount: countRow.event_count,
    };
  } catch {
    return {
      databasePath: fallbackPath,
      databaseSizeBytes: existsSync(fallbackPath) ? statSync(fallbackPath).size : null,
      databaseJobCount: null,
      databaseAttemptCount: null,
      databaseEventCount: null,
    };
  }
}

export function getRuntimeHealth(): RuntimeHealth {
  const radarrUrl = trimEnv(env.RADARR_URL);
  const radarrApiKey = trimEnv(env.RADARR_API_KEY);
  const sonarrUrl = trimEnv(env.SONARR_URL);
  const sonarrApiKey = trimEnv(env.SONARR_API_KEY);
  const plexUrl = trimEnv(env.PLEX_URL);
  const plexToken = trimEnv(env.PLEX_TOKEN);
  const origin = trimEnv(env.ORIGIN);
  const configuredLogLevel = trimEnv(env.LOG_LEVEL)?.toLowerCase() ?? 'info';
  const issues: string[] = [];
  const warnings: string[] = [];
  const storageMetrics = getStorageMetrics(dataPath);
  const databaseMetrics = getDatabaseMetrics();

  collectPairIssues(issues, warnings, 'Radarr', radarrUrl, radarrApiKey, true);
  collectPairIssues(issues, warnings, 'Sonarr', sonarrUrl, sonarrApiKey, true);
  collectPairIssues(issues, warnings, 'Plex', plexUrl, plexToken, false);

  if (!radarrUrl && !sonarrUrl && !radarrApiKey && !sonarrApiKey) {
    issues.push('At least one Arr service must be configured for the app to serve requests.');
  }

  if (!origin) {
    warnings.push(
      'ORIGIN is not set. Production adapter-node deployments should define it explicitly.',
    );
  }

  if (!validLogLevels.has(configuredLogLevel)) {
    warnings.push(`LOG_LEVEL "${configuredLogLevel}" is not recognized. Falling back to "info".`);
  }

  if (storageMetrics.freeSpaceBytes === null || storageMetrics.totalSpaceBytes === null) {
    warnings.push(`Storage stats are unavailable for ${storageMetrics.storagePath}.`);
  }

  if (
    databaseMetrics.databaseJobCount === null ||
    databaseMetrics.databaseAttemptCount === null ||
    databaseMetrics.databaseEventCount === null
  ) {
    warnings.push(`Database stats are unavailable for ${databaseMetrics.databasePath}.`);
  }

  return {
    checkedAt: new Date().toISOString(),
    healthy: issues.length === 0,
    issues,
    warnings,
    logFilePath: LOG_FILE_PATH,
    logLevel: validLogLevels.has(configuredLogLevel) ? configuredLogLevel : 'info',
    dataPath,
    storagePath: storageMetrics.storagePath,
    freeSpaceBytes: storageMetrics.freeSpaceBytes,
    totalSpaceBytes: storageMetrics.totalSpaceBytes,
    databasePath: databaseMetrics.databasePath,
    databaseSizeBytes: databaseMetrics.databaseSizeBytes,
    databaseJobCount: databaseMetrics.databaseJobCount,
    databaseAttemptCount: databaseMetrics.databaseAttemptCount,
    databaseEventCount: databaseMetrics.databaseEventCount,
    uptimeSeconds: Math.max(0, Math.round(process.uptime())),
    nodeVersion: process.version,
    hostName: hostname(),
    platform: process.platform,
    arch: process.arch,
    processId: process.pid,
    rssBytes: process.memoryUsage().rss,
    heapTotalBytes: process.memoryUsage().heapTotal,
    heapUsedBytes: process.memoryUsage().heapUsed,
    systemTotalMemoryBytes: totalmem(),
    systemFreeMemoryBytes: freemem(),
  };
}

export function getConfiguredServiceFlags(): ServiceConfigurationFlags {
  const radarrConfigured = Boolean(trimEnv(env.RADARR_URL) && trimEnv(env.RADARR_API_KEY));
  const sonarrConfigured = Boolean(trimEnv(env.SONARR_URL) && trimEnv(env.SONARR_API_KEY));
  const plexConfigured = Boolean(trimEnv(env.PLEX_URL) && trimEnv(env.PLEX_TOKEN));

  return {
    radarrConfigured,
    sonarrConfigured,
    plexConfigured,
    configured: radarrConfigured || sonarrConfigured,
  };
}

export function ensureRuntimeBootLog(): void {
  if (bootLogged) {
    return;
  }

  bootLogged = true;
  const runtime = getRuntimeHealth();

  logger.log(runtime.healthy ? 'info' : 'warn', 'Runtime configuration summary', {
    healthy: runtime.healthy,
    issues: runtime.issues.length,
    warnings: runtime.warnings.length,
    logLevel: runtime.logLevel,
    logFilePath: runtime.logFilePath,
    dataPath: runtime.dataPath,
    storagePath: runtime.storagePath,
    freeSpaceBytes: runtime.freeSpaceBytes,
    totalSpaceBytes: runtime.totalSpaceBytes,
    databasePath: runtime.databasePath,
    databaseSizeBytes: runtime.databaseSizeBytes,
    databaseJobCount: runtime.databaseJobCount,
    databaseAttemptCount: runtime.databaseAttemptCount,
    databaseEventCount: runtime.databaseEventCount,
    uptimeSeconds: runtime.uptimeSeconds,
    nodeVersion: runtime.nodeVersion,
    hostName: runtime.hostName,
    platform: runtime.platform,
    arch: runtime.arch,
    processId: runtime.processId,
    rssBytes: runtime.rssBytes,
    heapTotalBytes: runtime.heapTotalBytes,
    heapUsedBytes: runtime.heapUsedBytes,
    systemTotalMemoryBytes: runtime.systemTotalMemoryBytes,
    systemFreeMemoryBytes: runtime.systemFreeMemoryBytes,
    issueList: runtime.issues,
    warningList: runtime.warnings,
  });
}
