import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { getTargetScan, startMetadataMigration } from '../../../services/migrationService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

const MetadataMigrationDialog = ({ open, onClose, onMessage }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [targetBackend, setTargetBackend] = useState('postgresql');
  const [pg, setPg] = useState({ host: '', port: '5432', database: '', user: '', password: '' });
  const [sqlitePath, setSqlitePath] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [wipeConfirmed, setWipeConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const targetHasData = Boolean(scanResult && scanResult.schemaExists && scanResult.totalRows > 0);
  const startDisabled =
    starting || scanning || !scanResult || Boolean(scanError) || (targetHasData && !wipeConfirmed);

  useEffect(() => {
    if (!open) return undefined;
    setPg({ host: '', port: '5432', database: '', user: '', password: '' });
    setSqlitePath('');
    setMissingFields([]);
    setScanResult(null);
    setScanning(false);
    setScanError('');
    setWipeConfirmed(false);
    setStarting(false);
    setStartError('');
    return undefined;
  }, [open]);

  const buildPgConfig = () => ({
    host: pg.host.trim(),
    port: Number(pg.port) || 5432,
    database: pg.database.trim(),
    user: pg.user.trim(),
    password: pg.password,
    ssl: false,
  });

  const handleTargetBackendChange = (backend) => {
    setTargetBackend(backend);
    setMissingFields([]);
    setScanResult(null);
    setScanError('');
    setWipeConfirmed(false);
    setStartError('');
  };

  const handleScan = async () => {
    const required = targetBackend === 'postgresql' ? ['host', 'database', 'user', 'password'] : ['sqlitePath'];
    const missing = required.filter((field) => (field === 'sqlitePath' ? !sqlitePath.trim() : !pg[field].trim()));
    if (missing.length > 0) {
      setMissingFields(missing);
      setScanError(t('metadataMigration.requiredFields'));
      return;
    }
    setMissingFields([]);
    setScanError('');
    setStartError('');
    setScanResult(null);
    setWipeConfirmed(false);
    setScanning(true);
    const payload =
      targetBackend === 'postgresql'
        ? { targetBackend, pg: buildPgConfig() }
        : { targetBackend, sqlitePath: sqlitePath.trim() };
    try {
      const result = await getTargetScan(payload);
      setScanResult(result);
    } catch (error) {
      const errorData = error?.response?.data;
      setScanError(
        errorData?.errorCode === 'migrationInProgress'
          ? t('serverErrors.migrationInProgress')
          : getServerErrorDisplay(errorData, t) || t('metadataMigration.scanFail')
      );
    } finally {
      setScanning(false);
    }
  };

  const handleStart = async () => {
    if (targetHasData && !wipeConfirmed) return;
    setStartError('');
    setStarting(true);
    const payload = {
      targetBackend,
      ...(targetBackend === 'postgresql' ? { pg: buildPgConfig() } : { sqlitePath: sqlitePath.trim() }),
      wipeTarget: Boolean(wipeConfirmed),
    };
    try {
      await startMetadataMigration(payload);
      onClose();
      navigate('/migration');
    } catch (error) {
      const errorData = error?.response?.data;
      const errorText =
        errorData?.errorCode === 'migrationInProgress'
          ? t('serverErrors.migrationInProgress')
          : getServerErrorDisplay(errorData, t) || t('metadataMigration.startFail');
      setStartError(errorText);
      if (onMessage) onMessage({ type: 'error', text: errorText });
    } finally {
      setStarting(false);
    }
  };

  const handleClose = () => {
    onClose();
  };

  const renderPgFields = () => (
    <>
      <TextField
        fullWidth
        label={`${t('metadataMigration.host')} *`}
        value={pg.host}
        onChange={(e) => setPg({ ...pg, host: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('host')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={t('metadataMigration.port')}
        value={pg.port}
        onChange={(e) => setPg({ ...pg, port: e.target.value })}
        margin="normal"
        type="number"
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('metadataMigration.database')} *`}
        value={pg.database}
        onChange={(e) => setPg({ ...pg, database: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('database')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('metadataMigration.user')} *`}
        value={pg.user}
        onChange={(e) => setPg({ ...pg, user: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('user')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('metadataMigration.password')} *`}
        type="password"
        value={pg.password}
        onChange={(e) => setPg({ ...pg, password: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('password')}
        disabled={starting}
      />
    </>
  );

  const renderSqliteField = () => (
    <TextField
      fullWidth
      label={`${t('metadataMigration.sqlitePath')} *`}
      value={sqlitePath}
      onChange={(e) => setSqlitePath(e.target.value)}
      margin="normal"
      required
      error={missingFields.includes('sqlitePath')}
      helperText={t('metadataMigration.sqlitePathHint')}
      disabled={starting}
    />
  );

  const renderScanResult = () => {
    if (!scanResult) return null;
    if (scanError) return null;
    const tablesWithRows = (scanResult.tables || []).filter((table) => table.rows > 0);
    if (targetHasData) {
      return (
        <Alert severity="warning" sx={{ mt: 2 }} data-testid="metadata-wipe-alert">
          <Typography variant="body2">{t('metadataMigration.dataFound')}</Typography>
          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 3 }}>
            {tablesWithRows.map((table) => (
              <li key={table.name}>
                <Typography variant="body2">
                  {table.name}: {table.rows}
                </Typography>
              </li>
            ))}
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            {t('metadataMigration.totalRows', { count: scanResult.totalRows ?? 0 })}
          </Typography>
        </Alert>
      );
    }
    if (scanResult.schemaExists) {
      return (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('metadataMigration.schemaEmpty')}
        </Alert>
      );
    }
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        {t('metadataMigration.noSchema')}
      </Alert>
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('metadataMigration.title')}</DialogTitle>
      <DialogContent>
        <FormControl component="fieldset" sx={{ mt: 1 }}>
          <FormLabel>{t('metadataMigration.targetLabel')}</FormLabel>
          <RadioGroup row value={targetBackend} onChange={(e) => handleTargetBackendChange(e.target.value)}>
            <FormControlLabel
              value="postgresql"
              control={<Radio />}
              label={t('metadataMigration.targetPostgresql')}
              disabled={starting}
            />
            <FormControlLabel
              value="sqlite"
              control={<Radio />}
              label={t('metadataMigration.targetSqlite')}
              disabled={starting}
            />
          </RadioGroup>
        </FormControl>

        {targetBackend === 'postgresql' ? renderPgFields() : renderSqliteField()}

        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            onClick={handleScan}
            disabled={scanning || starting}
            startIcon={scanning ? <CircularProgress size={16} /> : null}
          >
            {scanning ? t('metadataMigration.scanning') : t('metadataMigration.scanTarget')}
          </Button>
        </Box>

        {scanError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {scanError}
          </Alert>
        )}

        {renderScanResult()}

        {targetHasData && (
          <FormControlLabel
            sx={{ mt: 2, display: 'flex' }}
            control={<Checkbox checked={wipeConfirmed} onChange={(e) => setWipeConfirmed(e.target.checked)} />}
            label={t('metadataMigration.wipeConfirm')}
          />
        )}

        {startError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {startError}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {t('metadataMigration.envNote')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={starting}>
          {t('common.close')}
        </Button>
        <Button
          variant="contained"
          onClick={handleStart}
          disabled={startDisabled}
          startIcon={starting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {starting ? t('metadataMigration.starting') : t('metadataMigration.start')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MetadataMigrationDialog;
