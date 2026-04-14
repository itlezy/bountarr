import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {},
}));

vi.mock('$lib/server/acquisition-db', () => ({
  defaultAcquisitionDatabasePath: () => 'data/acquisition.db',
  getAcquisitionDatabase: () => ({
    databasePath: 'data/acquisition.db',
    ownsDatabase: false,
    database: {
      prepare: () => ({
        get: () => ({
          job_count: 0,
          attempt_count: 0,
          event_count: 0,
        }),
      }),
    },
  }),
}));

vi.mock('$lib/server/logger', () => ({
  LOG_FILE_PATH: 'data/logs/backend.log',
  createAreaLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
  }),
  toErrorLogContext: () => ({}),
}));

describe('parseWindowsVolumeMetricsOutput', () => {
  it('keeps drive letters, mount points, and capacity figures from the helper payload', async () => {
    const { parseWindowsVolumeMetricsOutput } = await import('./runtime');

    const volumes = parseWindowsVolumeMetricsOutput(
      JSON.stringify([
        {
          driveLetter: 'C:',
          mountPoint: 'C:\\',
          label: 'SYSC',
          fileSystem: 'NTFS',
          freeSpaceBytes: 1_128_800_000_000,
          totalSpaceBytes: 1_861_400_000_000,
        },
        {
          driveLetter: null,
          mountPoint: 'C:\\M\\H20T00\\',
          label: 'H20T00',
          fileSystem: 'NTFS',
          freeSpaceBytes: 4_487_500_000_000,
          totalSpaceBytes: 18_627_000_000_000,
        },
      ]),
    );

    expect(volumes).toEqual([
      {
        driveLetter: 'C:',
        mountPoint: 'C:\\',
        label: 'SYSC',
        fileSystem: 'NTFS',
        freeSpaceBytes: 1_128_800_000_000,
        totalSpaceBytes: 1_861_400_000_000,
      },
      {
        driveLetter: null,
        mountPoint: 'C:\\M\\H20T00\\',
        label: 'H20T00',
        fileSystem: 'NTFS',
        freeSpaceBytes: 4_487_500_000_000,
        totalSpaceBytes: 18_627_000_000_000,
      },
    ]);
  });

  it('drops incomplete entries that do not expose a usable mount point or capacity', async () => {
    const { parseWindowsVolumeMetricsOutput } = await import('./runtime');

    const volumes = parseWindowsVolumeMetricsOutput(
      JSON.stringify([
        {
          driveLetter: null,
          mountPoint: null,
          totalSpaceBytes: 500,
        },
        {
          driveLetter: 'Z:',
          mountPoint: 'Z:\\',
          totalSpaceBytes: 0,
        },
        {
          driveLetter: 'F:',
          mountPoint: 'F:\\',
          freeSpaceBytes: 100,
          totalSpaceBytes: 200,
        },
      ]),
    );

    expect(volumes).toEqual([
      {
        driveLetter: 'F:',
        mountPoint: 'F:\\',
        label: null,
        fileSystem: null,
        freeSpaceBytes: 100,
        totalSpaceBytes: 200,
      },
    ]);
  });
});
