/**
 * MyPageContentPanel tests.
 * Verifies observable outcomes per spec: header, back/category icon, content, sticky header layout.
 * @see docs/spec/client/components/mypage/MyPageContentPanel.md
 * @see docs/TESTING_STRATEGY.md
 */
import React, { useEffect } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import MyPageContentPanel from '../MyPageContentPanel';
import { usePageHeader } from '../../../contexts/PageHeaderContext';

function ChildWithTitle({ title }) {
  const { setTitle } = usePageHeader();
  useEffect(() => {
    setTitle(title);
  }, [setTitle, title]);
  return <div data-testid="panel-child">{title}</div>;
}

describe('MyPageContentPanel', () => {
  it('renders children', () => {
    renderWithProviders(
      <MyPageContentPanel>
        <span data-testid="child">Child content</span>
      </MyPageContentPanel>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('shows Back button when onBack provided', () => {
    const onBack = jest.fn();
    renderWithProviders(
      <MyPageContentPanel onBack={onBack}>
        <span>Content</span>
      </MyPageContentPanel>
    );
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('shows category icon when onBack absent and categoryIcon provided', () => {
    const PersonIcon = () => <svg data-testid="person-icon" />;
    renderWithProviders(
      <MyPageContentPanel categoryIcon={PersonIcon}>
        <span>Content</span>
      </MyPageContentPanel>
    );
    expect(screen.getByTestId('person-icon')).toBeInTheDocument();
  });

  it('calls onBack when Back button clicked', async () => {
    const onBack = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel onBack={onBack}>
        <span>Content</span>
      </MyPageContentPanel>
    );
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('content area is scrollable (overflow)', () => {
    const { container } = renderWithProviders(
      <MyPageContentPanel>
        <span>Content</span>
      </MyPageContentPanel>
    );
    const scrollArea = screen.getByTestId('mypage-content-scroll');
    expect(scrollArea).toBeInTheDocument();
    expect(getComputedStyle(scrollArea).overflow).toBe('auto');
  });

  it('header stays visible when content scrolls (sticky header)', () => {
    renderWithProviders(
      <MyPageContentPanel onBack={jest.fn()}>
        <span>Content</span>
      </MyPageContentPanel>
    );
    const backButton = screen.getByRole('button', { name: /back/i });
    const scrollArea = screen.getByTestId('mypage-content-scroll');
    expect(backButton).toBeInTheDocument();
    expect(scrollArea).toBeInTheDocument();
    expect(scrollArea).not.toContainElement(backButton);
  });

  it('displays title from PageHeaderContext', () => {
    renderWithProviders(
      <MyPageContentPanel>
        <ChildWithTitle title="Account Info" />
      </MyPageContentPanel>
    );
    expect(screen.getByRole('heading', { name: 'Account Info' })).toBeInTheDocument();
  });
});
