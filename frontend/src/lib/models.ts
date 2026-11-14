export const GENERATION_MODELS = [
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
] as const;

export const EVALUATOR_MODELS = [
  { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
] as const;

export const DEFAULT_GENERATION_MODEL = 'gemini-3.8-flash';
export const DEFAULT_EVALUATOR_MODEL = 'gpt-5.6-luna';

// Display names for model IDs stored in history. Known IDs use the label above;
// others are prettified ("gemini-3-flash-preview" → "Gemini 3 Flash Preview").
// The raw ID stays the data key — this is only for display.
const KNOWN_LABELS: Record<string, string> = Object.fromEntries(
  [...GENERATION_MODELS, ...EVALUATOR_MODELS].map(m => [m.value, m.label])
);

export function modelLabel(id: string | null | undefined): string {
  if (!id) return '—';
  if (KNOWN_LABELS[id]) return KNOWN_LABELS[id];
  // Drop snapshot date suffixes: -2025-12-11, -20251211
  const base = id.replace(/[-_](\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  if (KNOWN_LABELS[base]) return KNOWN_LABELS[base];
  return base
    .replace(/(^|[-_])(\d+)[-_](\d+)(?=$|[-_])/, '$1$2.$3') // claude-sonnet-4-6 → 4.6
    .split(/[-_]/).filter(Boolean)
    .map(t => /^gpt$/i.test(t) ? 'GPT' : /^o\d/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1');
}
