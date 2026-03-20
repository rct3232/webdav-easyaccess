import { openUrlInNewTab } from '../browserNavigation';

describe('browserNavigation', () => {
  const originalWindowOpen = window.open;

  afterEach(() => {
    window.open = originalWindowOpen;
    jest.clearAllMocks();
  });

  it('opens the provided URL in a new tab with safe flags', () => {
    const openWindow = jest.fn();

    openUrlInNewTab('https://example.com/share/token', openWindow);

    expect(openWindow).toHaveBeenCalledWith(
      'https://example.com/share/token',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('uses the browser opener by default when one is available', () => {
    window.open = jest.fn();

    openUrlInNewTab('https://example.com/share/token');

    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/share/token',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does nothing when no opener is available', () => {
    expect(() => openUrlInNewTab('https://example.com/share/token', null)).not.toThrow();
  });
});
