import { copyToClipboard } from '../clipboard';

const setClipboard = (
  value: { writeText: (text: string) => Promise<void> } | undefined
) => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
};

const setExecCommand = (implementation: () => boolean) => {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(implementation),
  });
};

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
  });

  test('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    setExecCommand(() => true);

    await expect(copyToClipboard('阵容文本')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('阵容文本');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('returns the legacy copy result and always removes its textarea', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);

    await expect(copyToClipboard('无法复制')).resolves.toBe(false);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  test('falls back after an async Clipboard API rejection', async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new DOMException('denied')),
    });
    setExecCommand(() => true);

    await expect(copyToClipboard('备用复制')).resolves.toBe(true);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
