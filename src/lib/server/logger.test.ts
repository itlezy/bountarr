import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RotatingFileStream } from '$lib/server/logger';

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bountarr-logger-'));
  tempDirectories.push(directory);
  return directory;
}

function writeChunk(stream: RotatingFileStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('RotatingFileStream', () => {
  it('rotates the active file into numbered backups once the size limit is exceeded', async () => {
    const directory = createTempDirectory();
    const logPath = path.join(directory, 'backend.log');
    writeFileSync(logPath, '12345678', 'utf8');

    const stream = new RotatingFileStream(logPath, 10, 3);
    await writeChunk(stream, 'abcd');

    expect(readFileSync(logPath, 'utf8')).toBe('abcd');
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('12345678');
  });

  it('shifts existing backups forward and drops the oldest overflow backup', async () => {
    const directory = createTempDirectory();
    const logPath = path.join(directory, 'backend.log');
    writeFileSync(logPath, 'active-log', 'utf8');
    writeFileSync(`${logPath}.1`, 'backup-one', 'utf8');
    writeFileSync(`${logPath}.2`, 'backup-two', 'utf8');
    writeFileSync(`${logPath}.3`, 'backup-three', 'utf8');

    const stream = new RotatingFileStream(logPath, 12, 3);
    await writeChunk(stream, 'next');

    expect(readFileSync(logPath, 'utf8')).toBe('next');
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('active-log');
    expect(readFileSync(`${logPath}.2`, 'utf8')).toBe('backup-one');
    expect(readFileSync(`${logPath}.3`, 'utf8')).toBe('backup-two');
    expect(existsSync(`${logPath}.4`)).toBe(false);
  });

  it('keeps appending to the active file while the size stays under the limit', async () => {
    const directory = createTempDirectory();
    const logPath = path.join(directory, 'backend.log');
    writeFileSync(logPath, '12', 'utf8');

    const stream = new RotatingFileStream(logPath, 10, 3);
    await writeChunk(stream, '34');

    expect(readFileSync(logPath, 'utf8')).toBe('1234');
    expect(existsSync(`${logPath}.1`)).toBe(false);
  });
});
