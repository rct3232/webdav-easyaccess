import { useState, useCallback, useEffect } from 'react';
import { getFileBlob, getVideoPreviewStreamUrl } from '../../../../services/fileService';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import { getServerErrorDisplay } from '../../../../utils/errorUtils';

// Preview blob fetches disable transport retries: a fast server error (e.g. an
// S3/WebDAV auth failure the storage provider answers immediately) surfaces
// right away instead of after ~7s of backoff retries. The transport total
// timeout stays at the httpClient default (5 min) — no short cap here, so
// slow-but-working transfers on a healthy backend are never cut off.

export const usePreviewLoader = ({ open, displayFile, file, shareToken, t }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const loadPreview = useCallback(
    async (signal) => {
      const targetFile = displayFile || file;
      if (!targetFile) return;

      setLoading(true);
      setError(null);

      try {
        const filename = targetFile.name || targetFile.basename;
        const fileType = getFileType(filename);

        if (fileType === 'video') {
          const url = await getVideoPreviewStreamUrl(targetFile.nodeId, { shareToken });
          if (signal?.aborted) return;
          setPreviewUrl(url);
          setLoading(false);
          return;
        }

        const blob = await getFileBlob(targetFile.nodeId, {
          inline: true,
          shareToken,
          signal,
          maxRetries: 0,
        });
        if (signal?.aborted) return;

        if (fileType === 'text') {
          const text = await blob.text();
          if (signal?.aborted) return;
          setTextContent(text);
        } else if (fileType === 'pdf') {
          setPreviewBlob(blob);
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
        } else {
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
        }

        setLoading(false);
      } catch (err) {
        // A request is silently ignored only when the CALLER aborted it
        // (user navigated away / effect re-ran). httpClient surfaces its own
        // transport timeout as an error with code 'ECONNABORTED' too, but in
        // that case our signal is NOT aborted — treat it as a real failure so
        // the loading circle never spins indefinitely with no error shown.
        if (signal?.aborted) return;
        console.error('Preview load error:', err);
        const data = err?.response?.data;
        // Prefer the server errorCode (connection-class failures map to the
        // friendly `files.storageUnavailable` text); fall back to the generic
        // preview error for transport-level failures without a server response.
        setError(data?.errorCode ? getServerErrorDisplay(data, t) : t('preview.loadFail'));
        setLoading(false);
      }
    },
    [displayFile, file, shareToken, t]
  );

  useEffect(() => {
    const targetFile = displayFile || file;
    if (open && targetFile) {
      if (targetFile.canPreview !== false) {
        const controller = new AbortController();
        loadPreview(controller.signal);
        return () => controller.abort();
      } else {
        setLoading(false);
      }
    } else {
      setPreviewUrl((prevUrl) => {
        if (prevUrl && String(prevUrl).startsWith('blob:')) {
          URL.revokeObjectURL(prevUrl);
        }
        return null;
      });
      setPreviewBlob(null);
      setTextContent(null);
      setLoading(true);
      setError(null);
    }
  }, [open, displayFile, file, loadPreview, retryNonce]);

  // Re-run the load for the current file (used by the error-state retry button).
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return { loading, error, previewUrl, previewBlob, textContent, retry };
};
