import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ExactMovieTarget = {
  title: string;
  year: number;
};

export type LiveIntegrationConfig = {
  allowDestructive: boolean;
  appPort: number;
  baseUrl: string;
  duplicateMovie: ExactMovieTarget;
  radarrApiKey: string;
  radarrUrl: string;
  untrackedMovie: ExactMovieTarget;
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

function requiredEnvValue(name: string, envFileValues: Record<string, string>): string {
  const value = readEnvValue(name, envFileValues);
  if (!value) {
    throw new Error(`Missing required environment value ${name} for live integration tests.`);
  }

  return value;
}

export function loadLiveIntegrationConfig(): LiveIntegrationConfig {
  const repoRoot = process.cwd();
  const envFileValues = parseEnvFile(path.join(repoRoot, '.env'));
  const appPortValue = readEnvValue('BOUNTARR_INTEGRATION_PORT', envFileValues) ?? '4311';
  const appPort = Number.parseInt(appPortValue, 10);

  if (!Number.isFinite(appPort) || appPort <= 0) {
    throw new Error(`Invalid BOUNTARR_INTEGRATION_PORT value: ${appPortValue}`);
  }

  return {
    allowDestructive: readEnvValue('BOUNTARR_ALLOW_LIVE_INTEGRATION', envFileValues) === '1',
    appPort,
    baseUrl: `http://127.0.0.1:${appPort}`,
    duplicateMovie: {
      title: 'The Matrix',
      year: 1999,
    },
    radarrApiKey: requiredEnvValue('RADARR_API_KEY', envFileValues),
    radarrUrl: requiredEnvValue('RADARR_URL', envFileValues).replace(/\/+$/, ''),
    untrackedMovie: {
      title: 'Dredd',
      year: 2012,
    },
  };
}

export function assertLiveIntegrationEnabled(config: LiveIntegrationConfig): void {
  if (!config.allowDestructive) {
    throw new Error(
      'Live integration tests are destructive. Set BOUNTARR_ALLOW_LIVE_INTEGRATION=1 to run them.',
    );
  }
}
