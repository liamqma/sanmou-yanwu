import {
  PROMPT_COPY_EVENT_NAMES,
  recordSuccessfulPromptCopy,
  type PromptCopyEvent,
} from '../googleAnalytics';

describe('recordSuccessfulPromptCopy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'gtag');
  });

  test.each(
    Object.entries(PROMPT_COPY_EVENT_NAMES) as [PromptCopyEvent, string][]
  )('records the %s event without user data', (event, eventName) => {
    const gtag = vi.fn();
    window.gtag = gtag;

    recordSuccessfulPromptCopy(event);

    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith('event', eventName);
  });

  test('does nothing when Google Analytics is unavailable', () => {
    expect(() => recordSuccessfulPromptCopy('roundAnalysis')).not.toThrow();
  });

  test('does not break copying when Google Analytics throws', () => {
    window.gtag = vi.fn(() => {
      throw new Error('blocked');
    });

    expect(() => recordSuccessfulPromptCopy('roundAnalysis')).not.toThrow();
  });
});
