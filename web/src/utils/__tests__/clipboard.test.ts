import { copyImageToClipboard, copyToClipboard } from '../clipboard';

const setClipboard = (
  value: Partial<Clipboard> | undefined
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
    vi.unstubAllGlobals();
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

  test('copies a promised PNG through the binary Clipboard API', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    setClipboard({ write });
    const clipboardItems: Array<Record<string, Blob | Promise<Blob>>> = [];
    vi.stubGlobal(
      'ClipboardItem',
      class ClipboardItemMock {
        constructor(data: Record<string, Blob | Promise<Blob>>) {
          clipboardItems.push(data);
        }
      }
    );
    const png = new Blob(['png'], { type: 'image/png' });

    await expect(copyImageToClipboard(Promise.resolve(png))).resolves.toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await clipboardItems[0]['image/png']).toBe(png);
  });

  test('returns false when binary clipboard support is unavailable or rejects', async () => {
    setClipboard(undefined);
    await expect(
      copyImageToClipboard(new Blob(['png'], { type: 'image/png' }))
    ).resolves.toBe(false);

    const write = vi.fn().mockRejectedValue(new DOMException('denied'));
    setClipboard({ write });
    vi.stubGlobal('ClipboardItem', class ClipboardItemMock {});
    await expect(
      copyImageToClipboard(new Blob(['png'], { type: 'image/png' }))
    ).resolves.toBe(false);
  });
});
