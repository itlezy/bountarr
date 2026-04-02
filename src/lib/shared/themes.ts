export const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'wooden', label: 'Wooden' },
  { value: 'glass', label: 'Glass' },
  { value: 'lava', label: 'Lava' },
  { value: 'tron', label: 'Tron' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'short-circuit', label: 'Short Circuit' },
  { value: 'back-to-the-future', label: 'Back to the Future' },
  { value: 'snatch', label: 'Snatch' },
  { value: 'zebra', label: 'Zebra' },
] as const;

export type ThemeMode = (typeof themeOptions)[number]['value'];

export const resolvedThemeModes = themeOptions
  .map((option) => option.value)
  .filter((value) => value !== 'system');

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

export function sanitizeTheme(value: unknown, fallback: ThemeMode = 'system'): ThemeMode {
  if (typeof value !== 'string') {
    return fallback;
  }

  const match = themeOptions.find((option) => option.value === value);
  return match?.value ?? fallback;
}

export function resolveTheme(theme: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return theme;
}
