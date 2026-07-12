/**
 * Copy text to the clipboard, with a hidden-textarea + execCommand fallback for
 * environments where the async Clipboard API is unavailable (older browsers,
 * insecure contexts). Returns true on success, false if both paths fail.
 *
 * Consolidates the copy logic that used to be duplicated across GameBoard,
 * TeamBuilder and BuildATeam.
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy fallback below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
}
