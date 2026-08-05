import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicShareLinkInfo } from '../../../services/shareLinkService';
import { getAccessToken } from '../../../services/authTokenStore';
import { resolvePath } from '../../../services/fileService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

export const useShareLinkInfo = (token) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);

  useEffect(() => {
    if (!token) {
      setLinkInfo(null);
      setError(t('shareLink.invalidLink'));
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setLinkInfo(null);

      try {
        const info = await getPublicShareLinkInfo(token);
        let enriched = info;

        // C2.5: resolve the share root nodeId once at share-view entry when the API
        // does not carry it yet. Guarded by token presence: resolve-path requires
        // authentication and would trigger the 401 redirect for public share viewers.
        // Removed in Phase 5 once GET /share/:token/info returns a nodeId.
        if (
          info?.isDirectory &&
          info?.nodeId == null &&
          info?.filePath &&
          getAccessToken()
        ) {
          try {
            const resolved = await resolvePath(info.filePath);
            if (resolved?.nodeId != null) {
              enriched = { ...info, nodeId: resolved.nodeId };
            }
          } catch (err) {
            console.error('Share root nodeId resolution failed:', err);
          }
        }

        if (!cancelled) {
          setLinkInfo(enriched);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Share link load error:', err);
          const data = err?.response?.data;
          const msg = data ? getServerErrorDisplay(data, t) : t('shareLink.loadFail');
          setError(msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  return { loading, error, linkInfo };
};

