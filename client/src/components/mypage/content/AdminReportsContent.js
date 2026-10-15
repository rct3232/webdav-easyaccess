import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import * as adminService from '../../../services/adminService';
import { getServerErrorDisplay, getServerMessageDisplay } from '../../../utils/errorUtils';
import { ConfirmDialog } from '../../dialogs';

const KIND_LABEL_KEYS = {
  gc: 'admin.reports.kind.gc',
  migration: 'admin.reports.kind.migration',
  failsafe: 'admin.reports.kind.failsafe',
  night_eval: 'admin.reports.kind.night_eval',
  cleanup: 'admin.reports.kind.cleanup',
};

const STATUS_TONES = { ok: 'success', partial: 'warning' };

const STATUS_LABEL_KEYS = {
  ok: 'admin.reports.status.ok',
  partial: 'admin.reports.status.partial',
};

// Node entries carry a finite nodeId only when the value is usable on the
// repair bodies (guards against null/NaN ids reaching the dispatch).
const hasFiniteNodeId = (nodeId) => nodeId != null && Number.isFinite(Number(nodeId));

const asArray = (value) => (Array.isArray(value) ? value : []);

const sectionOf = (payload) =>
  payload && typeof payload === 'object' ? payload.contentHashCompleteness : undefined;

const localTime = (value, t) =>
  Number.isFinite(Number(value))
    ? String(value)
    : value == null
      ? t('admin.reports.unknown')
      : new Date(value).toLocaleString();

// Payload mining mirrors the server producers (AdminReportsContent.md §2.5) —
// same precedent as the cleanup-snackbar summary in SystemSettingsContent.
function summarizeReport(row, t) {
  const p = row.payload;
  if (!p || typeof p !== 'object') return '';
  if (row.kind === 'failsafe') {
    const section = sectionOf(p);
    return t('admin.reports.summary.failsafe', {
      scanned: p.scanned ?? 0,
      resolved: p.resolved ?? 0,
      review: asArray(p.manualReview).length,
      pending: p.pendingUpload?.scanned ?? 0,
      nullCount:
        section && Number.isFinite(section.nullCount)
          ? section.nullCount
          : t('admin.reports.unknown'),
    });
  }
  if (row.kind === 'gc') {
    if (p.error) return t('admin.reports.summary.gcFailed', { error: String(p.error) });
    return t('admin.reports.summary.gc', {
      blobs: p.tier1?.deletedBlobs ?? 0,
      rows: p.tier1?.deletedRows ?? 0,
      keys: p.tier2?.deletedKeys ?? 0,
      purged: p.tier3?.purgedNodes ?? 0,
    });
  }
  if (row.kind === 'cleanup') {
    return t('admin.reports.summary.cleanup', {
      orphaned: asArray(p.orphanedNodes).length,
      pending: asArray(p.pendingUploadNodes).length,
      errors: asArray(p.errors).length,
    });
  }
  return '';
}

// Backfill affordance: iff failsafe row ∧ contentHashCompleteness object ∧
// finite nullCount > 0 (server refuses the action everywhere else).
const canBackfill = (row) => {
  if (row.kind !== 'failsafe') return false;
  const section = sectionOf(row.payload);
  return (
    Boolean(section) &&
    typeof section === 'object' &&
    Number.isFinite(section.nullCount) &&
    section.nullCount > 0
  );
};

function nodeGroups(row, t) {
  const p = row.payload;
  if (!p || typeof p !== 'object') return [];
  if (row.kind === 'failsafe') {
    return [
      {
        heading: t('admin.reports.label.manualReview'),
        entries: asArray(p.manualReview).map((e) => ({
          nodeId: e.nodeId,
          label: e.path ?? e.name,
        })),
      },
      {
        heading: t('admin.reports.label.pendingUpload'),
        entries: asArray(p.pendingUpload?.nodes).map((e) => ({
          nodeId: e.nodeId,
          label: e.name ?? e.path,
        })),
      },
    ].filter((group) => group.entries.length > 0);
  }
  if (row.kind === 'cleanup') {
    return [
      {
        heading: t('admin.reports.label.orphanedNodes'),
        entries: asArray(p.orphanedNodes).map((e) => ({
          nodeId: e.nodeId,
          label: e.path ?? e.name,
        })),
      },
      {
        heading: t('admin.reports.label.pendingUploadNodes'),
        entries: asArray(p.pendingUploadNodes).map((e) => ({
          nodeId: e.nodeId,
          label: e.name ?? e.path,
        })),
      },
    ].filter((group) => group.entries.length > 0);
  }
  return [];
}

function gcTierLines(gc, t) {
  const lines = [];
  if (gc?.tier1) {
    lines.push({
      heading: t('admin.reports.label.tier1'),
      text: t('admin.reports.detail.tier1', {
        orphaned: gc.tier1.orphanedRows ?? 0,
        guarded: gc.tier1.guardedRows ?? 0,
        blobs: gc.tier1.deletedBlobs ?? 0,
        rows: gc.tier1.deletedRows ?? 0,
        pending: gc.tier1.pendingDeletedRows ?? 0,
      }),
      errors: asArray(gc.tier1.errors).length,
    });
  }
  if (gc?.tier2) {
    lines.push({
      heading: t('admin.reports.label.tier2'),
      text: t('admin.reports.detail.tier2', {
        scanned: gc.tier2.scannedKeys ?? 0,
        untracked: gc.tier2.untrackedKeys ?? 0,
        deleted: gc.tier2.deletedKeys ?? 0,
      }),
      errors: asArray(gc.tier2.errors).length,
    });
  }
  if (gc?.tier3) {
    lines.push({
      heading: t('admin.reports.label.tier3'),
      text: t('admin.reports.detail.tier3', {
        purged: gc.tier3.purgedNodes ?? 0,
        blobs: gc.tier3.deletedBlobs ?? 0,
        rows: gc.tier3.deletedRows ?? 0,
      }),
      errors: asArray(gc.tier3.errors).length,
    });
  }
  return lines;
}

function hasDetail(row, t) {
  const p = row.payload;
  if (!p || typeof p !== 'object') return false;
  if (row.kind === 'gc') return Boolean(p.tier1 || p.tier2 || p.tier3);
  if (row.kind === 'cleanup') {
    return nodeGroups(row, t).length > 0 || Boolean(p.gc) || asArray(p.errors).length > 0;
  }
  if (row.kind === 'failsafe') {
    return nodeGroups(row, t).length > 0 || Boolean(sectionOf(p));
  }
  return false;
}

const AdminReportsContent = ({ onSnackbar }) => {
  const { t } = useTranslation();
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [repairError, setRepairError] = useState('');
  const [expandedIds, setExpandedIds] = useState([]);
  const [busy, setBusy] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);

  const notify = (msg) => {
    if (onSnackbar) onSnackbar(msg);
  };

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await adminService.getAdminReports();
      setReports(Array.isArray(data?.reports) ? data.reports : []);
    } catch (error) {
      setLoadError(getServerErrorDisplay(error?.response?.data, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Success → Snackbar + list re-fetch (the failsafe row re-renders from the
  // server's re-read row); failure → translated inline Alert, no re-fetch.
  const runRepair = async (reportId, body, scope) => {
    setBusy(scope);
    setRepairError('');
    try {
      const res = await adminService.repairAdminReport(reportId, body);
      notify({ type: 'success', text: getServerMessageDisplay(res, t) });
      await loadReports();
    } catch (error) {
      setRepairError(getServerErrorDisplay(error?.response?.data, t));
    } finally {
      setBusy(null);
    }
  };

  const handleBackfill = (row) =>
    runRepair(row.id, { action: 'content_hash' }, { type: 'backfill', id: row.id });

  const handleNodeRepair = (row, entry) =>
    runRepair(
      row.id,
      { action: 'repair-sync', nodeId: entry.nodeId, repairAction: 'auto' },
      { type: 'repair', id: row.id, nodeId: entry.nodeId }
    );

  const handlePurgeConfirm = () => {
    const target = purgeTarget;
    setPurgeTarget(null);
    if (!target) return;
    runRepair(
      target.reportId,
      { action: 'perm-delete', nodeId: target.nodeId },
      { type: 'purge', id: target.reportId, nodeId: target.nodeId }
    );
  };

  const toggleExpanded = (id) =>
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const renderNodeGroup = (row, group) => (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {group.heading}
      </Typography>
      {group.entries.map((entry, index) => (
        <Box
          key={`${row.id}-${index}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}
        >
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
            {entry.label ?? `#${entry.nodeId}`}
          </Typography>
          {hasFiniteNodeId(entry.nodeId) && (
            <React.Fragment>
              <Button
                size="small"
                data-testid={`admin-reports-node-repair-${entry.nodeId}`}
                disabled={busy?.type === 'repair' && busy.nodeId === entry.nodeId}
                onClick={() => handleNodeRepair(row, entry)}
              >
                {busy?.type === 'repair' && busy.nodeId === entry.nodeId ? (
                  <CircularProgress size={14} sx={{ mr: 1 }} />
                ) : null}
                {t('admin.reports.repairSync')}
              </Button>
              <Button
                size="small"
                color="error"
                data-testid={`admin-reports-node-purge-${entry.nodeId}`}
                disabled={busy?.type === 'purge' && busy.nodeId === entry.nodeId}
                onClick={() =>
                  setPurgeTarget({ reportId: row.id, nodeId: entry.nodeId, name: entry.label })
                }
              >
                {t('admin.reports.purge')}
              </Button>
            </React.Fragment>
          )}
        </Box>
      ))}
    </Box>
  );

  const renderDetail = (row) => {
    const p = row.payload;
    const section = sectionOf(p);
    return (
      <Box sx={{ pl: 1 }}>
        {row.kind === 'failsafe' || row.kind === 'cleanup'
          ? nodeGroups(row, t).map((group) => (
              <React.Fragment key={group.heading}>{renderNodeGroup(row, group)}</React.Fragment>
            ))
          : null}
        {p.gc ? gcTierLines(p.gc, t).map((line) => renderTierLine(row, line)) : null}
        {row.kind === 'gc' ? gcTierLines(p, t).map((line) => renderTierLine(row, line)) : null}
        {row.kind === 'cleanup' && asArray(p.errors).length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {`${t('admin.reports.label.errors')}: ${asArray(p.errors).length}`}
          </Typography>
        )}
        {section && typeof section === 'object' ? (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2">
              {`${t('admin.reports.label.nullCount')}: ${
                Number.isFinite(section.nullCount) ? section.nullCount : t('admin.reports.unknown')
              }`}
            </Typography>
            <Typography variant="body2">
              {`${t('admin.reports.label.checkedAt')}: ${localTime(section.checkedAt, t)}`}
            </Typography>
            {Number.isFinite(section.backfilled) ? (
              <Typography variant="body2">
                {`${t('admin.reports.label.backfilled')}: ${section.backfilled}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };

  const renderTierLine = (row, line) => (
    <Box key={`${row.id}-${line.heading}`} sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {line.heading}
      </Typography>
      <Typography variant="body2">{line.text}</Typography>
      {line.errors > 0 ? (
        <Typography variant="body2" color="warning.main">
          {`${t('admin.reports.label.errors')}: ${line.errors}`}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <Box data-testid="admin-reports-section" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">{t('admin.reports.title')}</Typography>
        <IconButton
          onClick={loadReports}
          disabled={loading}
          color="primary"
          aria-label={t('admin.reports.refresh')}
          data-testid="admin-reports-refresh"
        >
          {loading ? <CircularProgress size={24} /> : <RefreshIcon />}
        </IconButton>
      </Box>

      {loadError ? (
        <Alert severity="error" sx={{ mt: 2 }} data-testid="admin-reports-error">
          {loadError}
        </Alert>
      ) : null}
      {repairError ? (
        <Alert severity="error" sx={{ mt: 2 }} data-testid="admin-reports-repair-error">
          {repairError}
        </Alert>
      ) : null}

      {reports && reports.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('admin.reports.empty')}
        </Typography>
      ) : null}

      {(reports || []).map((row) => {
        const summary = summarizeReport(row, t);
        const expanded = expandedIds.includes(row.id);
        const detail = hasDetail(row, t);
        const backfillBusy = busy?.type === 'backfill' && busy.id === row.id;
        return (
          <Box
            key={row.id}
            data-testid={`admin-reports-row-${row.id}`}
            sx={{ mt: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{new Date(row.created_at).toLocaleString()}</Typography>
                {summary ? (
                  <Typography variant="body2" color="text.secondary">
                    {summary}
                  </Typography>
                ) : null}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  size="small"
                  label={KIND_LABEL_KEYS[row.kind] ? t(KIND_LABEL_KEYS[row.kind]) : row.kind}
                />
                <Chip
                  size="small"
                  color={STATUS_TONES[row.status] || 'default'}
                  label={
                    STATUS_LABEL_KEYS[row.status] ? t(STATUS_LABEL_KEYS[row.status]) : row.status
                  }
                />
                {canBackfill(row) ? (
                  <Button
                    size="small"
                    variant="outlined"
                    data-testid={`admin-reports-backfill-${row.id}`}
                    disabled={backfillBusy}
                    onClick={() => handleBackfill(row)}
                  >
                    {backfillBusy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                    {t('admin.reports.backfill')}
                  </Button>
                ) : null}
                {detail ? (
                  <IconButton
                    size="small"
                    data-testid={`admin-reports-expand-${row.id}`}
                    onClick={() => toggleExpanded(row.id)}
                    aria-label={expanded ? t('admin.reports.collapse') : t('admin.reports.expand')}
                  >
                    {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                ) : null}
              </Box>
            </Box>
            <Collapse in={expanded} unmountOnExit>
              {expanded ? renderDetail(row) : null}
            </Collapse>
          </Box>
        );
      })}

      <ConfirmDialog
        open={purgeTarget != null}
        onClose={() => setPurgeTarget(null)}
        onConfirm={handlePurgeConfirm}
        title={t('actions.purge')}
        message={t('admin.reports.purgeConfirmBody', { name: purgeTarget?.name })}
        confirmText={t('actions.purge')}
        cancelText={t('common.cancel')}
        confirmColor="error"
      />
    </Box>
  );
};

export default AdminReportsContent;
