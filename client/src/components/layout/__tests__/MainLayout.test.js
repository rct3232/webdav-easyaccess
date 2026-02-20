/**
 * MainLayout tests.
 * Verifies observable outcomes per spec: Outlet, gradient box, layout structure.
 * @see docs/spec/client/components/layout/MainLayout.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import MainLayout from '../MainLayout';

function TestPage() {
  return <div data-testid="page-content">Page content</div>;
}

function renderMainLayout() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<TestPage />} />
      </Route>
    </Routes>,
    { initialEntries: ['/'] }
  );
}

describe('MainLayout', () => {
  it('renders Outlet content', () => {
    renderMainLayout();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('renders gradient background box', () => {
    const { container } = renderMainLayout();
    const gradientBox = container.querySelector('.dynamic-appbar-gradient');
    expect(gradientBox).toBeInTheDocument();
  });

  it('renders gradient-bg-green inside gradient box', () => {
    const { container } = renderMainLayout();
    const gradientBg = container.querySelector('.gradient-bg-green');
    expect(gradientBg).toBeInTheDocument();
  });
});
