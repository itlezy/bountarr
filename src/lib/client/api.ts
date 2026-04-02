import type {
  ArrDeleteTarget,
  AcquisitionJobActionResponse,
  DashboardResponse,
  ManualReleaseListResponse,
  MediaItemActionResponse,
  MediaItem,
  Preferences,
  QueueActionResponse,
  QueueItem,
  QueueResponse,
  RequestResponse,
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

export async function cancelQueueItem(item: QueueItem): Promise<QueueActionResponse> {
  return requestJson<QueueActionResponse>(
    '/api/queue/cancel',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        arrItemId: item.arrItemId,
        canCancel: item.canCancel,
        id: item.id,
        kind: item.kind,
        queueId: item.queueId,
        sourceService: item.sourceService,
        title: item.title,
      }),
    },
    'Unable to cancel the selected download.',
  );
}

export async function deleteArrItem(item: ArrDeleteTarget): Promise<MediaItemActionResponse> {
  return requestJson<MediaItemActionResponse>(
    '/api/media/delete',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        arrItemId: item.arrItemId,
        id: item.id,
        kind: item.kind,
        queueId: item.queueId,
        sourceService: item.sourceService,
        title: item.title,
      }),
    },
    'Unable to delete the selected Arr item.',
  );
}

export async function submitRequest(
  item: MediaItem,
  preferences: UserPreferencesPayload,
  qualityProfileId?: number | null,
): Promise<RequestResponse> {
  return requestJson<RequestResponse>(
    '/api/request',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item,
        qualityProfileId: qualityProfileId ?? undefined,
        preferences,
      }),
    },
    'Add failed.',
  );
}
