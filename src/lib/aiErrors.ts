/**
 * Shared error classification for AI routes (Track 4c).
 * Maps provider error messages to user-friendly strings.
 */

export function classifyAIError(err: unknown): { userMessage: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes('401') ||
    lower.includes('invalid_api_key') ||
    lower.includes('api_key') ||
    lower.includes('authenticationerror') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication')
  ) {
    return { userMessage: 'Invalid API key — check AI Settings.', status: 401 };
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { userMessage: 'Rate limit hit — try again in a moment.', status: 429 };
  }

  if (
    lower.includes('503') ||
    lower.includes('timeout') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable')
  ) {
    return { userMessage: 'Provider is currently slow — please retry.', status: 503 };
  }

  if (
    lower.includes('json') ||
    lower.includes('parse') ||
    lower.includes('unexpected output') ||
    lower.includes('invalid json')
  ) {
    return { userMessage: 'AI returned unexpected output — try rephrasing.', status: 422 };
  }

  return { userMessage: msg, status: 500 };
}
