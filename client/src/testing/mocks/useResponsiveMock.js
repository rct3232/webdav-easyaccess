export function createUseResponsiveModuleMock(overrides = {}) {
  const defaultValue = {
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  };

  return {
    useResponsive: () => ({
      ...defaultValue,
      ...overrides,
    }),
  };
}
