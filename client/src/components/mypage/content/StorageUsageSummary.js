/**
 * StorageUsageSummary — current storage breakdown plus the daily usage
 * sparkline (docs/spec/client/components/mypage/content/StorageDashboard.md
 * §2.3 blocks 1-2). Pure view: the host supplies `current` and `series`;
 * no quota/percentage copy is rendered. The sparkline requires at
 * least two points and uses actual UTC-day spacing when the days parse.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';

import { formatFileSize } from '../../../utils/format';

const SPARKLINE_HEIGHT = 24;

function parseDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

export function buildSparklinePoints(points = []) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const values = points.map((point) => Number(point?.bytes) || 0);
  const max = Math.max(...values, 1);
  const times = points.map((point) => parseDay(point?.day));
  const validTimes = times.every((time) => time != null);
  const minTime = validTimes ? Math.min(...times) : null;
  const maxTime = validTimes ? Math.max(...times) : null;
  const usesDaySpacing = validTimes && maxTime > minTime;

  return points
    .map((point, index) => {
      const x = usesDaySpacing
        ? ((times[index] - minTime) / (maxTime - minTime)) * 100
        : (index / (points.length - 1)) * 100;
      const ratio = values[index] / max;
      return `${x},${SPARKLINE_HEIGHT - ratio * SPARKLINE_HEIGHT}`;
    })
    .join(' ');
}

const StorageUsageSummary = ({ current, series }) => {
  const { t } = useTranslation();

  if (!current || typeof current !== 'object') return null;

  // Canonical wire names are `*_bytes`; the plain aliases keep the view
  // tolerant of an older/current-less server naming without changing layout.
  const sizeOf = (key) => Number(current[`${key}_bytes`] ?? current[key]) || 0;
  // [rowKey, labelKey, value] — rowKey feeds the stable testid
  // (`storage-usage-<rowKey>`, E2E-S3-STORAGE-001); the label stays i18n-owned.
  const rows = [
    ['total', 'mypage.storageUsageTotal', sizeOf('total')],
    ['live', 'mypage.storageUsageLive', sizeOf('live')],
    ['trash', 'mypage.storageUsageTrash', sizeOf('trash')],
  ];
  if (current.version_history_supported !== false) {
    rows.push(['versions', 'mypage.storageUsageVersions', sizeOf('versions')]);
  }

  const points = Array.isArray(series?.points) ? series.points : [];
  const sparkline = points.length >= 2 ? buildSparklinePoints(points) : '';

  return (
    <Box component="section" sx={{ mb: 3 }} data-testid="storage-usage-summary">
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('mypage.storageUsageTitle')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {rows.map(([rowKey, labelKey, value]) => (
          <Box key={rowKey} data-testid={`storage-usage-${rowKey}`}>
            <Typography variant="caption" color="text.secondary" display="block">
              {t(labelKey)}
            </Typography>
            <Typography variant="body2">{formatFileSize(Number(value) || 0)}</Typography>
          </Box>
        ))}
      </Box>
      {current.incomplete ? (
        <Typography
          variant="caption"
          color="warning.main"
          sx={{ display: 'block', mt: 1 }}
          data-testid="storage-usage-incomplete"
        >
          {t('mypage.storageUsageIncomplete')}
        </Typography>
      ) : null}
      {sparkline ? (
        <Box
          component="svg"
          viewBox={`0 0 100 ${SPARKLINE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('mypage.storageUsageSparkline')}
          sx={{ width: '100%', height: 48, mt: 1 }}
          data-testid="storage-usage-sparkline"
        >
          <polyline fill="none" stroke="currentColor" points={sparkline} />
        </Box>
      ) : null}
    </Box>
  );
};

export default StorageUsageSummary;
