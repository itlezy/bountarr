import type { AcquisitionJob, AcquisitionReasonCode, AcquisitionStatus } from '$lib/shared/types';

export function acquisitionReasonLabel(code: AcquisitionReasonCode | null): string | null {
  switch (code) {
    case 'validated':
      return 'Download checked out';
    case 'missing-audio':
      return 'Missing preferred audio';
    case 'missing-subs':
      return 'Missing selected subtitles';
    case 'import-timeout':
      return 'Download or import took too long';
    case 'no-release-available':
      return 'No release was available';
    case 'no-acceptable-release':
      return 'Nothing suitable was found';
    case 'cancelled':
      return 'Stopped by user';
    case 'crashed':
      return 'Something went wrong';
    default:
      return null;
  }
}

function queuedNextAction(status: AcquisitionStatus): string | null {
  switch (status) {
    case 'queued':
      return 'Getting things ready.';
    case 'searching':
      return 'Looking for a release.';
    case 'grabbing':
      return 'Sending the choice to your downloader.';
    case 'validating':
      return 'Checking the downloaded files.';
    default:
      return null;
  }
}

export function acquisitionNextAction(
  job: Pick<AcquisitionJob, 'autoRetrying' | 'reasonCode' | 'status'>,
): string | null {
  if (job.status === 'completed') {
    return 'Ready to watch.';
  }

  if (job.status === 'cancelled') {
    return 'Stopped. No more releases will be tried.';
  }

  if (job.status === 'failed') {
    if (job.reasonCode === 'no-release-available' || job.reasonCode === 'no-acceptable-release') {
      return 'Stopped because no acceptable release remains.';
    }

    if (job.reasonCode === 'crashed') {
      return 'Stopped because the acquisition flow crashed.';
    }

    return 'Stopped after automatic retries were exhausted.';
  }

  if (job.status === 'retrying' || job.autoRetrying) {
    return 'Trying another option automatically.';
  }

  return queuedNextAction(job.status);
}
