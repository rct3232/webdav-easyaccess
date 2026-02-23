import { createContext, useContext } from 'react';

export const PageHeaderContext = createContext(null);

export const usePageHeader = () => {
  const context = useContext(PageHeaderContext);
  if (!context) {
    throw new Error('usePageHeader must be used within a PageHeaderContext.Provider');
  }
  return context;
};
