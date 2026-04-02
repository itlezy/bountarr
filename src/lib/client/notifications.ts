import type { MediaItem } from '$lib/shared/types';

const seenAlerts = new Set<string>();

export async function ensureNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'default') {
    return Notification.requestPermission();
  }

  return Notification.permission;
}

export function pushNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export function notifyAuditFailures(items: MediaItem[]): void {
  for (const item of items) {
    if (item.auditStatus !== 'missing-language' && item.auditStatus !== 'no-subs') {
      continue;
    }

    const key = `${item.id}:${item.auditStatus}`;
    if (seenAlerts.has(key)) {
      continue;
    }

    seenAlerts.add(key);
    const reason =
      item.auditStatus === 'missing-language'
        ? 'missing the preferred audio language'
        : 'missing the selected subtitle language';

    pushNotification('Bountarr audit warning', `${item.title} is ${reason}.`);
  }
}
