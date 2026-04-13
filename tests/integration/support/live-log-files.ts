import { existsSync, readFileSync, statSync } from 'node:fs';

export type LogCheckpoint = {
  path: string;
  size: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createLogCheckpoint(path: string): LogCheckpoint {
  if (!existsSync(path)) {
    return {
      path,
      size: 0,
    };
  }

  return {
    path,
    size: statSync(path).size,
  };
}

export function readLogAppendix(checkpoint: LogCheckpoint): string {
  if (!existsSync(checkpoint.path)) {
    return '';
  }

  const contents = readFileSync(checkpoint.path);
  if (checkpoint.size >= contents.byteLength) {
    return '';
  }

  return contents.subarray(checkpoint.size).toString('utf8');
}

export function countLiteralOccurrences(contents: string, value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const matches = contents.match(new RegExp(escapeRegExp(value), 'g'));
  return matches?.length ?? 0;
}

export function countRadarrSabQueueAdds(contents: string, releaseTitle: string): number {
  if (releaseTitle.length === 0) {
    return 0;
  }

  const escapedTitle = escapeRegExp(releaseTitle);
  const matches = contents.match(
    new RegExp(`Sabnzbd\\|Adding report \\[${escapedTitle}\\] to the queue`, 'g'),
  );
  return matches?.length ?? 0;
}

export function countSabQueueAdds(contents: string, releaseTitle: string): number {
  if (releaseTitle.length === 0) {
    return 0;
  }

  const escapedTitle = escapeRegExp(releaseTitle);
  const exactParenthesized = contents.match(new RegExp(`\\(${escapedTitle}\\) to queue`, 'g'));
  const exactBracketed = contents.match(
    new RegExp(`Adding report \\[${escapedTitle}\\] to the queue`, 'g'),
  );
  return (exactParenthesized?.length ?? 0) + (exactBracketed?.length ?? 0);
}
