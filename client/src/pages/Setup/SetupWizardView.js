import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';

function TestConnectionControls({ target, testState, viewModel, onTestConnection }) {
  const isTesting = testState?.status === 'testing';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
      <Button variant="outlined" onClick={() => onTestConnection(target)} disabled={isTesting}>
        {isTesting ? viewModel.testing : viewModel.testConnection}
      </Button>
      {isTesting && <CircularProgress size={20} />}
      {testState?.status === 'ok' && (
        <Typography variant="body2" color="success.main">
          {testState.message}
        </Typography>
      )}
      {testState?.status === 'error' && (
        <Box>
          <Typography variant="body2" color="error.main">
            {testState.message}
          </Typography>
          {testState.reason && !testState.message.includes(testState.reason) && (
            <Typography variant="caption" color="text.secondary">
              {testState.reason}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

const SetupWizardView = ({
  statusLoading,
  loadError,
  restartRequired,
  activeStep,
  stepCount,
  form,
  errors,
  testStates,
  applyState,
  viewModel,
  onBack,
  onNext,
  onFileBackendChange,
  onFieldChange,
  onCheckboxChange,
  onTestConnection,
  onRegenerateSecret,
  onApply,
}) => {
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('sm'));

  // A step that offers a connection test cannot be left until the test passed:
  // editing a field already resets the result (useSetupWizard), so a stale 'ok'
  // can never unlock Next.
  const testRequiredStep =
    activeStep === 0 && (form.fileBackend === 's3' || form.fileBackend === 'webdav');
  const testTarget = activeStep === 0 ? form.fileBackend : null;
  const testPassed = !testRequiredStep || testStates[testTarget]?.status === 'ok';

  const renderFileStorageStep = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        {viewModel.fileBackend}
      </Typography>
      <RadioGroup
        row
        value={form.fileBackend}
        onChange={(event, value) => onFileBackendChange(value)}
      >
        <FormControlLabel value="s3" control={<Radio />} label={viewModel.fileS3} />
        <FormControlLabel value="webdav" control={<Radio />} label={viewModel.fileWebdav} />
      </RadioGroup>
      {form.fileBackend === 's3' ? (
        <Box sx={{ mt: 1 }}>
          <TextField
            fullWidth
            margin="normal"
            required
            label={viewModel.bucket}
            value={form.s3.bucket}
            onChange={onFieldChange('s3', 'bucket')}
            inputProps={{ 'data-testid': 'setup-s3-bucket' }}
          />
          <TextField
            fullWidth
            margin="normal"
            required
            label={viewModel.region}
            value={form.s3.region}
            onChange={onFieldChange('s3', 'region')}
            inputProps={{ 'data-testid': 'setup-s3-region' }}
          />
          <TextField
            fullWidth
            margin="normal"
            required
            label={viewModel.accessKeyId}
            value={form.s3.accessKeyId}
            onChange={onFieldChange('s3', 'accessKeyId')}
            inputProps={{ 'data-testid': 'setup-s3-accessKeyId' }}
          />
          <TextField
            fullWidth
            margin="normal"
            required
            type="password"
            label={viewModel.secretAccessKey}
            value={form.s3.secretAccessKey}
            onChange={onFieldChange('s3', 'secretAccessKey')}
            inputProps={{ 'data-testid': 'setup-s3-secretAccessKey' }}
          />
          <TextField
            fullWidth
            margin="normal"
            label={viewModel.endpoint}
            value={form.s3.endpoint}
            onChange={onFieldChange('s3', 'endpoint')}
            inputProps={{ 'data-testid': 'setup-s3-endpoint' }}
          />
          <TestConnectionControls
            target="s3"
            testState={testStates.s3}
            viewModel={viewModel}
            onTestConnection={onTestConnection}
          />
        </Box>
      ) : (
        <Box sx={{ mt: 1 }}>
          <TextField
            fullWidth
            margin="normal"
            required
            label={viewModel.url}
            value={form.webdav.url}
            onChange={onFieldChange('webdav', 'url')}
            inputProps={{ 'data-testid': 'setup-webdav-url' }}
          />
          <TextField
            fullWidth
            margin="normal"
            required
            label={viewModel.username}
            value={form.webdav.username}
            onChange={onFieldChange('webdav', 'username')}
            inputProps={{ 'data-testid': 'setup-webdav-username' }}
          />
          <TextField
            fullWidth
            margin="normal"
            required
            type="password"
            label={viewModel.password}
            value={form.webdav.password}
            onChange={onFieldChange('webdav', 'password')}
            inputProps={{ 'data-testid': 'setup-webdav-password' }}
          />
          <TestConnectionControls
            target="webdav"
            testState={testStates.webdav}
            viewModel={viewModel}
            onTestConnection={onTestConnection}
          />
        </Box>
      )}
      {errors[0] && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errors[0]}
        </Alert>
      )}
    </Box>
  );

  const renderAdminJwtStep = () => (
    <Box>
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.adminUsername}
        value="admin"
        disabled
        helperText={viewModel.adminUsernameFixed}
      />
      <TextField
        fullWidth
        margin="normal"
        required
        type="password"
        label={viewModel.adminPassword}
        value={form.admin.password}
        onChange={onFieldChange('admin', 'password')}
        inputProps={{ 'data-testid': 'setup-admin-password' }}
      />
      <TextField
        fullWidth
        margin="normal"
        required
        label={viewModel.jwtSecret}
        value={form.jwt.secret}
        onChange={onFieldChange('jwt', 'secret')}
        inputProps={{ 'data-testid': 'setup-jwt-secret' }}
      />
      <Button variant="outlined" onClick={onRegenerateSecret}>
        {viewModel.regenerate}
      </Button>
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.expiresIn}
        value={form.jwt.expiresIn}
        onChange={onFieldChange('jwt', 'expiresIn')}
        helperText={viewModel.expiresInHelp}
        inputProps={{ 'data-testid': 'setup-jwt-expiresIn' }}
      />
      {errors[1] && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errors[1]}
        </Alert>
      )}
    </Box>
  );

  const renderOptionalStep = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        {viewModel.stepLabels[2]}
      </Typography>
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.serverPort}
        value={form.server.port}
        onChange={onFieldChange('server', 'port')}
        inputProps={{ 'data-testid': 'setup-server-port' }}
      />
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.corsOrigins}
        value={form.server.corsOrigins}
        onChange={onFieldChange('server', 'corsOrigins')}
        inputProps={{ 'data-testid': 'setup-server-corsOrigins' }}
      />
      <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
        {viewModel.smtpTitle}
      </Typography>
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.smtpHost}
        value={form.email.host}
        onChange={onFieldChange('email', 'host')}
        inputProps={{ 'data-testid': 'setup-email-host' }}
      />
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.smtpPort}
        value={form.email.port}
        onChange={onFieldChange('email', 'port')}
        inputProps={{ 'data-testid': 'setup-email-port' }}
      />
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.smtpUser}
        value={form.email.user}
        onChange={onFieldChange('email', 'user')}
        inputProps={{ 'data-testid': 'setup-email-user' }}
      />
      <TextField
        fullWidth
        margin="normal"
        type="password"
        label={viewModel.smtpPassword}
        value={form.email.password}
        onChange={onFieldChange('email', 'password')}
        inputProps={{ 'data-testid': 'setup-email-password' }}
      />
      <FormControlLabel
        control={
          <Checkbox checked={form.email.secure} onChange={onCheckboxChange('email', 'secure')} />
        }
        label={viewModel.smtpSecure}
      />
      <TextField
        fullWidth
        margin="normal"
        label={viewModel.smtpFromName}
        value={form.email.fromName}
        onChange={onFieldChange('email', 'fromName')}
        inputProps={{ 'data-testid': 'setup-email-fromName' }}
      />
    </Box>
  );

  const renderApplyStep = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        {viewModel.stepLabels[3]}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {viewModel.applyIntro}
      </Typography>
      {applyState.status === 'error' && applyState.message && (
        <Alert severity="error">{applyState.message}</Alert>
      )}
    </Box>
  );

  if (restartRequired) {
    return (
      <Container maxWidth="sm">
        <Paper elevation={0} sx={{ p: 4, mt: 8, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom>
            {viewModel.restartRequiredTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {viewModel.restartRequiredBody}
          </Typography>
        </Paper>
      </Container>
    );
  }

  if (statusLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Container maxWidth="sm">
        <Paper elevation={0} sx={{ p: 4, mt: 8 }}>
          <Alert severity="error">{loadError}</Alert>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md">
      <Paper elevation={0} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h5" gutterBottom>
          {viewModel.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {viewModel.subtitle}
        </Typography>
        {isMobile ? (
          <Typography variant="subtitle1" sx={{ mb: 3, fontWeight: 600 }}>
            {viewModel.stepCounter} · {viewModel.stepLabels[activeStep]}
          </Typography>
        ) : (
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
            {viewModel.stepLabels.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}
        <Box>
          {activeStep === 0 && renderFileStorageStep()}
          {activeStep === 1 && renderAdminJwtStep()}
          {activeStep === 2 && renderOptionalStep()}
          {activeStep === 3 && renderApplyStep()}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button onClick={onBack} disabled={activeStep === 0}>
            {viewModel.back}
          </Button>
          {activeStep < stepCount - 1 ? (
            <Button variant="contained" color="primary" onClick={onNext} disabled={!testPassed}>
              {viewModel.next}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={onApply}
              disabled={applyState.status === 'applying'}
            >
              {applyState.status === 'applying' ? viewModel.applying : viewModel.applyButton}
            </Button>
          )}
        </Box>
      </Paper>
    </Container>
  );
};

export default SetupWizardView;
