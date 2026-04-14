import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type LiveRuntimeScope = 'integration' | 'live-ui';

export type LiveRuntimePaths = {
  root: string;
  databasePath: string;
  databaseSidecarPaths: string[];
  stdoutLogPath: string;
  stderrLogPath: string;
  runInfoPath: string;
};

export function liveRuntimePaths(
  repoRoot = process.cwd(),
  scope: LiveRuntimeScope,
): LiveRuntimePaths {
  const root = path.join(repoRoot, 'data', 'runtime', scope);
  const databasePath = path.join(root, 'acquisition.db');

  return {
    root,
    databasePath,
    databaseSidecarPaths: [databasePath, `${databasePath}-shm`, `${databasePath}-wal`],
    stdoutLogPath: path.join(root, 'app.stdout.log'),
    stderrLogPath: path.join(root, 'app.stderr.log'),
    runInfoPath: path.join(root, 'run.json'),
  };
}

export function ensureLiveRuntimeRoot(
  repoRoot = process.cwd(),
  scope: LiveRuntimeScope,
): LiveRuntimePaths {
  const paths = liveRuntimePaths(repoRoot, scope);
  mkdirSync(paths.root, { recursive: true });
  return paths;
}

export function resetLiveRuntimeState(
  repoRoot = process.cwd(),
  scope: LiveRuntimeScope,
): LiveRuntimePaths {
  const paths = ensureLiveRuntimeRoot(repoRoot, scope);

  for (const candidatePath of [
    ...paths.databaseSidecarPaths,
    paths.stdoutLogPath,
    paths.stderrLogPath,
    paths.runInfoPath,
  ]) {
    if (existsSync(candidatePath)) {
      rmSync(candidatePath, { force: true });
    }
  }

  return paths;
}

export function writeLiveRuntimeRunInfo(
  runtimePaths: LiveRuntimePaths,
  runInfo: Record<string, unknown>,
): void {
  writeFileSync(runtimePaths.runInfoPath, `${JSON.stringify(runInfo, null, 2)}\n`, 'utf8');
}

export function appendLiveRuntimeLog(
  runtimePaths: LiveRuntimePaths,
  stream: 'stdout' | 'stderr',
  chunk: string,
): void {
  appendFileSync(
    stream === 'stdout' ? runtimePaths.stdoutLogPath : runtimePaths.stderrLogPath,
    chunk,
    'utf8',
  );
}
