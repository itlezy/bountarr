import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveRuntimePaths } from './live-runtime-paths';

describe('live runtime paths', () => {
  it('maps integration runtime files under data/runtime/integration', () => {
    const repoRoot = 'C:\\repo\\bountarr';
    const runtime = liveRuntimePaths(repoRoot, 'integration');

    expect(runtime.root).toBe(path.join(repoRoot, 'data', 'runtime', 'integration'));
    expect(runtime.databasePath).toBe(
      path.join(repoRoot, 'data', 'runtime', 'integration', 'acquisition.db'),
    );
    expect(runtime.stdoutLogPath).toBe(
      path.join(repoRoot, 'data', 'runtime', 'integration', 'app.stdout.log'),
    );
    expect(runtime.stderrLogPath).toBe(
      path.join(repoRoot, 'data', 'runtime', 'integration', 'app.stderr.log'),
    );
    expect(runtime.runInfoPath).toBe(
      path.join(repoRoot, 'data', 'runtime', 'integration', 'run.json'),
    );
  });

  it('maps live-ui runtime files under data/runtime/live-ui', () => {
    const repoRoot = 'C:\\repo\\bountarr';
    const runtime = liveRuntimePaths(repoRoot, 'live-ui');

    expect(runtime.root).toBe(path.join(repoRoot, 'data', 'runtime', 'live-ui'));
    expect(runtime.databasePath).toBe(
      path.join(repoRoot, 'data', 'runtime', 'live-ui', 'acquisition.db'),
    );
    expect(runtime.databaseSidecarPaths).toEqual([
      path.join(repoRoot, 'data', 'runtime', 'live-ui', 'acquisition.db'),
      path.join(repoRoot, 'data', 'runtime', 'live-ui', 'acquisition.db-shm'),
      path.join(repoRoot, 'data', 'runtime', 'live-ui', 'acquisition.db-wal'),
    ]);
  });
});
