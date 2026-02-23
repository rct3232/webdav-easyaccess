/**
 * PreferencesContent tests.
 * Verifies observable outcomes per spec: title/description, flag button, language menu, i18n.changeLanguage.
 * @see docs/spec/client/components/mypage/content/PreferencesContent.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils';
import MyPageContentPanel from '../../MyPageContentPanel';
import PreferencesContent from '../PreferencesContent';
import i18n from '../../../../i18n';

describe('PreferencesContent', () => {
  let changeLanguageSpy;

  beforeAll(() => {
    changeLanguageSpy = jest.spyOn(i18n, 'changeLanguage').mockImplementation(() => {});
  });

  afterAll(() => {
    changeLanguageSpy.mockRestore();
  });

  beforeEach(() => {
    changeLanguageSpy.mockClear();
  });

  it('renders title and description on left, current language flag button on right', () => {
    renderWithProviders(
      <MyPageContentPanel>
        <PreferencesContent />
      </MyPageContentPanel>
    );

    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Select the interface language')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /language/i })).toBeInTheDocument();
  });

  it('clicking flag opens Menu with ko, en', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <PreferencesContent />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /language/i }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /ko/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /en/ })).toBeInTheDocument();
  });

  it('selecting option calls i18n.changeLanguage and closes menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <PreferencesContent />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /language/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /ko/ }));

    expect(changeLanguageSpy).toHaveBeenCalledWith('ko');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('current language is visually indicated as selected in menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <PreferencesContent />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /language/i }));

    const enItem = screen.getByRole('menuitem', { name: /en/ });
    const koItem = screen.getByRole('menuitem', { name: /ko/ });

    expect(enItem).toHaveClass('Mui-selected');
    expect(koItem).not.toHaveClass('Mui-selected');
  });
});
