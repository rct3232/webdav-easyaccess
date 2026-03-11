/**
 * Copy text to clipboard.
 * Tries navigator.clipboard.writeText first (HTTPS / secure context),
 * then falls back to document.execCommand('copy') for HTTP environments.
 * @param {string} text
 * @returns {Promise<void>}
 * @throws {Error} when copy fails in both methods or input is not a string
 */
export async function copyToClipboard(text) {
  if (typeof text !== 'string') {
    throw new Error('copyToClipboard expects a string');
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Fall through to execCommand fallback
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand copy returned false');
  } finally {
    document.body.removeChild(textarea);
  }
}
