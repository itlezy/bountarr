import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { HealthResponse } from '$lib/shared/types';
import { getJson } from './live-http';
import type { LiveIntegrationConfig } from './live-config';
import {
  appendLiveRuntimeLog,
  ensureLiveRuntimeRoot,
  liveRuntimePaths,
  resetLiveRuntimeState,
  type LiveRuntimePaths,
  writeLiveRuntimeRunInfo,
} from './live-runtime-paths';

export type RunningLiveApp = {
  process: ChildProcessWithoutNullStreams;
  runtimePaths: LiveRuntimePaths;
  stop: () => Promise<void>;
};

export type StartLiveAppOptions = {
  resetRuntime?: boolean;
};

export function resetBountarrStateFiles(repoRoot = process.cwd()): void {
  const runtimePaths = liveRuntimePaths(repoRoot, 'integration');
  for (const candidatePath of runtimePaths.databaseSidecarPaths) {
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

export async function startLiveApp(
  config: LiveIntegrationConfig,
  options: StartLiveAppOptions = {},
): Promise<RunningLiveApp> {
  const repoRoot = process.cwd();
  const buildEntryPoint = path.join(repoRoot, 'build', 'index.js');
  const runtimePaths =
    options.resetRuntime === true
      ? resetLiveRuntimeState(repoRoot, 'integration')
      : ensureLiveRuntimeRoot(repoRoot, 'integration');
  if (!existsSync(buildEntryPoint)) {
    throw new Error(`Build output was not found at ${buildEntryPoint}. Run npm run build first.`);
  }

  const runInfo = {
    acquisitionDatabasePath: runtimePaths.databasePath,
    baseUrl: config.baseUrl,
    buildEntryPoint,
    pid: null as number | null,
    port: config.appPort,
    scope: 'integration',
    startedAt: new Date().toISOString(),
    stderrLogPath: runtimePaths.stderrLogPath,
    stdoutLogPath: runtimePaths.stdoutLogPath,
  };
  writeLiveRuntimeRunInfo(runtimePaths, runInfo);

  const child = spawn('node', ['--env-file-if-exists=.env', buildEntryPoint], {
    cwd: repoRoot,
    env: {
      ACQUISITION_DB_PATH: runtimePaths.databasePath,
      ...process.env,
      ORIGIN: config.baseUrl,
      PORT: String(config.appPort),
    },
    stdio: 'pipe',
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    appendLiveRuntimeLog(runtimePaths, 'stdout', text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    appendLiveRuntimeLog(runtimePaths, 'stderr', text);
  });
  writeLiveRuntimeRunInfo(runtimePaths, {
    ...runInfo,
    pid: child.pid ?? null,
  });
  child.once('exit', (exitCode, signal) => {
    writeLiveRuntimeRunInfo(runtimePaths, {
      ...runInfo,
      exitedAt: new Date().toISOString(),
      exitCode,
      pid: child.pid ?? null,
      signal,
      status: 'exited',
    });
  });

  try {
    await waitForHealthy(config.baseUrl);
  } catch (error) {
    if (!child.killed) {
      child.kill('SIGKILL');
    }

    const details = [stdout.trim(), stderr.trim()].filter((entry) => entry.length > 0).join('\n');
    throw new Error(
      `Unable to start the live integration app. See ${runtimePaths.runInfoPath} for metadata and ${runtimePaths.stdoutLogPath} / ${runtimePaths.stderrLogPath} for process output.${details.length > 0 ? `\n${details}` : ''}`,
      {
        cause: error,
      },
    );
  }

  return {
    process: child,
    runtimePaths,
    stop: async () => {
      if (child.killed || child.exitCode !== null) {
        return;
      }

      const exitPromise = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });

      child.kill('SIGKILL');
      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 5_000);
        }),
      ]);
    },
  };
}
