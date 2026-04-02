export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asRecordsArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return asArray(asRecord(value).records);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asPositiveNumber(value: unknown): number | null {
  const number = asNumber(value);
  return number !== null && number > 0 ? number : null;
}

export function asScalarString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value);
  }

  return null;
}
