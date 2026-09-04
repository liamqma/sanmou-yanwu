/**
 * Copy text to the clipboard, with a hidden-textarea + execCommand fallback for
 * environments where the async Clipboard API is unavailable (older browsers,
 * insecure contexts). Returns true on success, false if both paths fail.
 *
 * Shared by the game board and contribution flow.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy fallback below.
  }

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}

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
