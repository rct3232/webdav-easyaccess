import { useState, useCallback, useEffect } from 'react';
import { getFileBlob, getVideoPreviewStreamUrl } from '../../../../services/fileService';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

export const usePreviewLoader = ({ open, displayFile, file, shareToken, t }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [textContent, setTextContent] = useState(null);

  const loadPreview = useCallback(async (signal) => {
    const targetFile = displayFile || file;
    if (!targetFile) return;

    setLoading(true);
    setError(null);

    try {
      const filename = targetFile.name || targetFile.basename;
      const fileType = getFileType(filename);

      if (fileType === 'video') {
        const url = await getVideoPreviewStreamUrl(targetFile.path, { shareToken });
        if (signal?.aborted) return;
        setPreviewUrl(url);
        setLoading(false);
        return;
      }

      const blob = await getFileBlob(targetFile.path, { inline: true, shareToken, signal });
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
      if (err?.name === 'AbortError') return;
      console.error('Preview load error:', err);
      setError(t('preview.loadFail'));
      setLoading(false);
    }
  }, [displayFile, file, shareToken, t]);

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
  }, [open, displayFile, file, loadPreview]);

  return { loading, error, previewUrl, previewBlob, textContent };
};
