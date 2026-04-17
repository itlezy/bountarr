import type {
  ArrDeleteTarget,
  AcquisitionJobActionResponse,
  DashboardResponse,
  GrabResponse,
  ManualReleaseListResponse,
  MediaItemActionResponse,
  MediaItem,
  Preferences,
  QueueCancelRequest,
  QueueEntry,
  QueueActionResponse,
  QueueResponse,
  SearchAvailability,
  SearchKind,
} from '$lib/shared/types';

type UserPreferencesPayload = Pick<Preferences, 'preferredLanguage' | 'subtitleLanguage'>;

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = (await response.text()).trim();
  return text.length > 0 ? text : fallback;
}

async function requestJson<T>(
  input: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }

  return (await response.json()) as T;
}

function auditPreferencesQuery(preferences: UserPreferencesPayload): string {
  return new URLSearchParams({
    preferredLanguage: preferences.preferredLanguage,
    subtitleLanguage: preferences.subtitleLanguage,
  }).toString();
}

export async function fetchDashboard(
  preferences: UserPreferencesPayload,
): Promise<DashboardResponse> {
  return requestJson<DashboardResponse>(
    `/api/dashboard?${auditPreferencesQuery(preferences)}`,
    undefined,
    'Unable to load the dashboard.',
  );
}

export async function refreshDashboard(
  preferences: UserPreferencesPayload,
): Promise<DashboardResponse> {
  return requestJson<DashboardResponse>(
    '/api/dashboard/refresh',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferences),
    },
    'Unable to refresh the dashboard.',
  );
}

export async function fetchRecentPlexItems(): Promise<MediaItem[]> {
  return requestJson<MediaItem[]>(
    '/api/plex/recent',
    undefined,
    'Unable to load Plex recent items.',
  );
}

export async function fetchSearchResults(
  query: string,
  kind: SearchKind,
  availability: SearchAvailability,
): Promise<MediaItem[]> {
  const params = new URLSearchParams({
    q: query.trim(),
    kind,
    availability,
  });

  return requestJson<MediaItem[]>(`/api/search?${params.toString()}`, undefined, 'Search failed.');
}

export async function fetchQueue(): Promise<QueueResponse> {
  return requestJson<QueueResponse>('/api/queue', undefined, 'Unable to load the queue.');
}

export async function fetchManualReleaseResults(jobId: string): Promise<ManualReleaseListResponse> {
  return requestJson<ManualReleaseListResponse>(
    `/api/acquisition/${encodeURIComponent(jobId)}/releases`,
    undefined,
    'Unable to load manual-search releases.',
  );
}

export async function selectManualRelease(
  jobId: string,
  guid: string,
  indexerId: number,
): Promise<AcquisitionJobActionResponse> {
  return requestJson<AcquisitionJobActionResponse>(
    `/api/acquisition/${encodeURIComponent(jobId)}/select`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        guid,
        indexerId,
      }),
    },
    'Unable to select the requested release.',
  );
}

export async function cancelAcquisitionJob(jobId: string): Promise<AcquisitionJobActionResponse> {
  return requestJson<AcquisitionJobActionResponse>(
    `/api/acquisition/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
    },
    'Unable to cancel the selected download.',
  );
}

function queueCancelPayload(entry: QueueEntry): QueueCancelRequest {
  if (entry.kind === 'managed') {
    return {
      kind: 'managed',
      jobId: entry.job.id,
    };
  }

  if (entry.item.queueId === null) {
    throw new Error('This download cannot be cancelled.');
  }

  return {
    kind: 'external',
    id: entry.id,
    arrItemId: entry.item.arrItemId,
    queueId: entry.item.queueId,
    sourceService: entry.item.sourceService,
    title: entry.item.title,
  };
}

export async function cancelQueueEntry(entry: QueueEntry): Promise<QueueActionResponse> {
  return requestJson<QueueActionResponse>(
    '/api/queue/cancel',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(queueCancelPayload(entry)),
    },
    'Unable to cancel the selected download.',
  );
}

export async function deleteArrItem(item: ArrDeleteTarget): Promise<MediaItemActionResponse> {
  const payload =
    item.deleteMode === 'library'
      ? {
          deleteMode: item.deleteMode,
          arrItemId: item.arrItemId,
          id: item.id,
          kind: item.kind,
          sourceService: item.sourceService,
          title: item.title,
        }
      : {
          deleteMode: item.deleteMode,
          id: item.id,
          kind: item.kind,
          queueId: item.queueId,
          sourceService: item.sourceService,
          title: item.title,
        };

  return requestJson<MediaItemActionResponse>(
    '/api/media/delete',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    'Unable to delete the selected Arr item.',
  );
}

export async function submitGrab(
  item: MediaItem,
  preferences: UserPreferencesPayload,
  qualityProfileId?: number | null,
  seasonNumbers?: number[],
): Promise<GrabResponse> {
  return requestJson<GrabResponse>(
    '/api/grab',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item,
        qualityProfileId: qualityProfileId ?? undefined,
        preferences,
        seasonNumbers: seasonNumbers && seasonNumbers.length > 0 ? seasonNumbers : undefined,
      }),
    },
    'Grab failed.',
  );
}

export async function resolveGrabCandidate(
  item: MediaItem,
  preferences: UserPreferencesPayload,
): Promise<MediaItem | null> {
  return requestJson<MediaItem | null>(
    '/api/grab/resolve',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item,
        preferences,
      }),
    },
    'Unable to prepare this title for grabbing.',
  );
}
