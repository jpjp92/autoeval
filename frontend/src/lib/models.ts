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
