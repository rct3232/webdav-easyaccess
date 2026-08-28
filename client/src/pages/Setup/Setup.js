import React from 'react';
import { Container, Box } from '@mui/material';

import { useSetupWizard } from './hooks/useSetupWizard';
import SetupWizardView from './SetupWizardView';

const Setup = () => {
  const wizard = useSetupWizard();

  return (
    <Container>
      <Box
        sx={{
          minHeight: 'var(--app-height)',
          py: 4,
        }}
      >
        <SetupWizardView {...wizard} />
      </Box>
    </Container>
  );
};

export default Setup;
