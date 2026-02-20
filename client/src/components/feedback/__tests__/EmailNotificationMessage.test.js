/**
 * EmailNotificationMessage tests.
 * Verifies observable outcomes per spec: renders translated message.
 * @see docs/spec/client/components/feedback/EmailNotificationMessage.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import EmailNotificationMessage from '../EmailNotificationMessage';

describe('EmailNotificationMessage', () => {
  it('renders translated message from i18n', () => {
    renderWithProviders(<EmailNotificationMessage />);
    expect(screen.getByText('Approval result will be sent to your email.')).toBeInTheDocument();
  });
});
