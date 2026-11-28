/**
 * Copy a PNG to the system clipboard. Accepting a promise lets callers start
 * the Clipboard API write during the user gesture while card artwork is still
 * being rendered. Browsers without binary clipboard support return false so
 * the caller can offer a visible share/download fallback.
 */
export async function copyImageToClipboard(
  png: Blob | Promise<Blob>
): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false;
  }

  try {
    const item = new ClipboardItem({ 'image/png': Promise.resolve(png) });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}
