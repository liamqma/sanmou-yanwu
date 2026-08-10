export const PROMPT_COPY_EVENT_NAMES = {
  roundAnalysis: 'copy_round_analysis_prompt',
  teamStrengthReview: 'copy_team_strength_review_prompt',
} as const;

export type PromptCopyEvent = keyof typeof PROMPT_COPY_EVENT_NAMES;

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string) => void;
  }
}

/**
 * Record an effective prompt use without sending roster or clipboard data.
 * Google Analytics may be unavailable because the tag has not loaded or the
 * visitor blocks it, so tracking must never interfere with copying.
 */
export function recordSuccessfulPromptCopy(event: PromptCopyEvent): void {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('event', PROMPT_COPY_EVENT_NAMES[event]);
  } catch {
    // Analytics is best-effort and must not break the user's copy action.
  }
}
