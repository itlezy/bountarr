export const cardViewOptions = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
  { value: 'soft', label: 'Soft' },
  { value: 'outline', label: 'Outline' },
  { value: 'borderless', label: 'Borderless' },
] as const;

export type CardViewMode = (typeof cardViewOptions)[number]['value'];

export function sanitizeCardView(value: unknown, fallback: CardViewMode = 'rounded'): CardViewMode {
  if (typeof value !== 'string') {
    return fallback;
  }

  const match = cardViewOptions.find((option) => option.value === value);
  return match?.value ?? fallback;
}
