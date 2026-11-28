import { copyImageToClipboard } from '../clipboard';

const setClipboard = (
  value: Partial<Clipboard> | undefined
) => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
};

describe('copyImageToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
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
