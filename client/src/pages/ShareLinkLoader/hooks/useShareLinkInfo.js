import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicShareLinkInfo } from '../../../services/shareLinkService';
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

        if (!cancelled) {
          setLinkInfo(info);
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
