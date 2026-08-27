export function createUseResponsiveModuleMock(overrides = {}) {
  const defaultValue = {
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  };

  const { useResponsive: useResponsiveOverride, ...valueOverrides } = overrides;

  return {
    useResponsive: useResponsiveOverride || (() => ({
      ...defaultValue,
      ...valueOverrides,
    })),
  };
}
