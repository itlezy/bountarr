import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { HealthResponse } from '$lib/shared/types';
import { getJson } from './live-http';
import type { LiveIntegrationConfig } from './live-config';

export type RunningLiveApp = {
  process: ChildProcessWithoutNullStreams;
  stop: () => Promise<void>;
};

function integrationDatabasePath(repoRoot: string): string {
  return path.join(repoRoot, 'data', 'runtime', 'integration', 'acquisition.db');
}

function databasePaths(repoRoot: string): string[] {
  const basePath = integrationDatabasePath(repoRoot);
  return [basePath, `${basePath}-shm`, `${basePath}-wal`];
}

export function resetBountarrStateFiles(repoRoot = process.cwd()): void {
  mkdirSync(path.dirname(integrationDatabasePath(repoRoot)), { recursive: true });
  for (const candidatePath of databasePaths(repoRoot)) {
    if (existsSync(candidatePath)) {
      rmSync(candidatePath, { force: true });
    }
  }
}

async function waitForHealthy(baseUrl: string): Promise<HealthResponse> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const health = await getJson<HealthResponse>(`${baseUrl}/api/health`);
      if (health.status === 'ok') {
        return health;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`Timed out waiting for ${baseUrl} to become healthy.`);
}

export async function startLiveApp(config: LiveIntegrationConfig): Promise<RunningLiveApp> {
  const repoRoot = process.cwd();
  const buildEntryPoint = path.join(repoRoot, 'build', 'index.js');
  const acquisitionDatabasePath = integrationDatabasePath(repoRoot);
  if (!existsSync(buildEntryPoint)) {
    throw new Error(`Build output was not found at ${buildEntryPoint}. Run npm run build first.`);
  }

  mkdirSync(path.dirname(acquisitionDatabasePath), { recursive: true });
  const child = spawn('node', ['--env-file-if-exists=.env', buildEntryPoint], {
    cwd: repoRoot,
    env: {
      ACQUISITION_DB_PATH: acquisitionDatabasePath,
      ...process.env,
      ORIGIN: config.baseUrl,
      PORT: String(config.appPort),
    },
    stdio: 'pipe',
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealthy(config.baseUrl);
  } catch (error) {
    if (!child.killed) {
      child.kill('SIGKILL');
    }

    const details = [stdout.trim(), stderr.trim()].filter((entry) => entry.length > 0).join('\n');
    throw new Error(
      `Unable to start the live integration app.${details.length > 0 ? `\n${details}` : ''}`,
      {
        cause: error,
      },
    );
  }

  return {
    process: child,
    stop: async () => {
      if (child.killed || child.exitCode !== null) {
        return;
      }

      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
    },
  };
}
