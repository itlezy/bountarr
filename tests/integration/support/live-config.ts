import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type ExactMovieTarget = {
  title: string;
  year: number;
};

export type ExactSeriesTarget = ExactMovieTarget;

type LiveWireInputs = {
  duplicateMovie?: Partial<ExactMovieTarget>;
  seriesCandidates?: string[];
  trackedMovieCandidates?: string[];
  untrackedMovie?: Partial<ExactMovieTarget>;
  untrackedSeries?: Partial<ExactSeriesTarget>;
};

export type LiveIntegrationConfig = {
  allowDestructive: boolean;
  appPort: number;
  baseUrl: string;
  duplicateMovie: ExactMovieTarget;
  radarrLogPath: string;
  radarrApiKey: string;
  radarrUrl: string;
  sabLogPath: string;
  seriesCandidates: string[];
  sonarrApiKey: string | null;
  sonarrUrl: string | null;
  trackedMovieCandidates: string[];
  untrackedMovie: ExactMovieTarget;
  untrackedSeries: ExactSeriesTarget;
};

function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function readEnvValue(name: string, envFileValues: Record<string, string>): string | null {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromFile = envFileValues[name]?.trim();
  return fromFile && fromFile.length > 0 ? fromFile : null;
}

function readLiveWireInputs(repoRoot: string): LiveWireInputs {
  const inputPath = path.join(repoRoot, 'live-wire-inputs.local.json');
  if (!existsSync(inputPath)) {
    return {};
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as unknown;
  return typeof raw === 'object' && raw !== null ? (raw as LiveWireInputs) : {};
}

function requiredEnvValue(name: string, envFileValues: Record<string, string>): string {
  const value = readEnvValue(name, envFileValues);
  if (!value) {
    throw new Error(`Missing required environment value ${name} for live integration tests.`);
  }

  return value;
}

function readInputString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInputYear(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function localInputMessage(name: string): string {
  return `Missing live-wire input ${name}. Add it to live-wire-inputs.local.json before enabling destructive live tests.`;
}

function liveTarget(
  name: string,
  envTitleName: string,
  envYearName: string,
  localTarget: Partial<ExactMovieTarget> | undefined,
  envFileValues: Record<string, string>,
  allowDestructive: boolean,
): ExactMovieTarget {
  const title = readEnvValue(envTitleName, envFileValues) ?? readInputString(localTarget?.title);
  const year = readInputYear(readEnvValue(envYearName, envFileValues) ?? localTarget?.year);

  if (title && year !== null) {
    return { title, year };
  }

  if (allowDestructive) {
    throw new Error(localInputMessage(name));
  }

  return {
    title: name,
    year: 1,
  };
}

function localStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readInputString).filter((entry): entry is string => entry !== null)
    : [];
}

export function loadLiveIntegrationConfig(): LiveIntegrationConfig {
  const repoRoot = process.cwd();
  const userHome = homedir();
  const envFileValues = parseEnvFile(path.join(repoRoot, '.env'));
  const liveWireInputs = readLiveWireInputs(repoRoot);
  const allowDestructive = readEnvValue('BOUNTARR_ALLOW_LIVE_INTEGRATION', envFileValues) === '1';
  const appPortValue = readEnvValue('BOUNTARR_INTEGRATION_PORT', envFileValues) ?? '4311';
  const appPort = Number.parseInt(appPortValue, 10);

  if (!Number.isFinite(appPort) || appPort <= 0) {
    throw new Error(`Invalid BOUNTARR_INTEGRATION_PORT value: ${appPortValue}`);
  }

  const duplicateMovie = liveTarget(
    'duplicateMovie',
    'BOUNTARR_DUPLICATE_MOVIE_TITLE',
    'BOUNTARR_DUPLICATE_MOVIE_YEAR',
    liveWireInputs.duplicateMovie,
    envFileValues,
    allowDestructive,
  );
  const untrackedMovie = liveTarget(
    'untrackedMovie',
    'BOUNTARR_LIVE_MOVIE_TITLE',
    'BOUNTARR_LIVE_MOVIE_YEAR',
    liveWireInputs.untrackedMovie,
    envFileValues,
    allowDestructive,
  );
  const untrackedSeries = liveTarget(
    'untrackedSeries',
    'BOUNTARR_LIVE_SERIES_TITLE',
    'BOUNTARR_LIVE_SERIES_YEAR',
    liveWireInputs.untrackedSeries,
    envFileValues,
    allowDestructive,
  );
  const seriesCandidates = localStringArray(liveWireInputs.seriesCandidates);
  const trackedMovieCandidates = localStringArray(liveWireInputs.trackedMovieCandidates);

  return {
    allowDestructive,
    appPort,
    baseUrl: `http://127.0.0.1:${appPort}`,
    duplicateMovie,
    radarrLogPath:
      readEnvValue('RADARR_LOG_PATH', envFileValues) ??
      'C:\\var\\tarr\\RADARR_DATA_ENG\\logs\\radarr.txt',
    radarrApiKey: requiredEnvValue('RADARR_API_KEY', envFileValues),
    radarrUrl: requiredEnvValue('RADARR_URL', envFileValues).replace(/\/+$/, ''),
    sabLogPath:
      readEnvValue('SAB_LOG_PATH', envFileValues) ??
      path.join(userHome, 'AppData', 'Local', 'sabnzbd', 'logs', 'sabnzbd.log'),
    seriesCandidates:
      seriesCandidates.length > 0 ? [...new Set(seriesCandidates)] : [untrackedSeries.title],
    sonarrApiKey: readEnvValue('SONARR_API_KEY', envFileValues),
    sonarrUrl: readEnvValue('SONARR_URL', envFileValues)?.replace(/\/+$/, '') ?? null,
    trackedMovieCandidates:
      trackedMovieCandidates.length > 0
        ? [...new Set(trackedMovieCandidates)]
        : [duplicateMovie.title],
    untrackedMovie,
    untrackedSeries,
  };
}

export function assertLiveIntegrationEnabled(config: LiveIntegrationConfig): void {
  if (!config.allowDestructive) {
    throw new Error(
      'Live integration tests are destructive. Set BOUNTARR_ALLOW_LIVE_INTEGRATION=1 to run them.',
    );
  }
}
