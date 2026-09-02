import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../../contexts/AuthContext';
import {
  DEFAULT_MY_PAGE_CATEGORY,
  getMyPageSidebarCategories,
  resolveMyPageCategory,
} from '../../../utils/myPageRegistry';

export function useMyPageController({ isMobile }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = Boolean(user?.is_admin);

  const resolveCategory = useCallback((cat) => resolveMyPageCategory(cat, isAdmin), [isAdmin]);

  const initCategory = useMemo(() => {
    return resolveCategory(location.state?.category ?? DEFAULT_MY_PAGE_CATEGORY);
  }, [location.state?.category, resolveCategory]);

  const [selectedCategory, setSelectedCategory] = useState(initCategory);
  const [selectedContentItem, setSelectedContentItem] = useState(null);
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);

  const sidebarItems = useMemo(() => getMyPageSidebarCategories(isAdmin), [isAdmin]);

  useEffect(() => {
    const cat = resolveCategory(location.state?.category);
    setSelectedCategory(cat);
    setSelectedContentItem(null);
  }, [location.state?.category, resolveCategory]);

  const onSelectCategory = useCallback(
    (categoryId) => {
      setSelectedCategory(categoryId);
      setSelectedContentItem(null);
      if (isMobile) setCategoryDrawerOpen(false);
    },
    [isMobile]
  );

  const onSelectContentItem = useCallback((itemId) => {
    setSelectedContentItem(itemId);
  }, []);

  const onOpenCategoryDrawer = useCallback(() => setCategoryDrawerOpen(true), []);
  const onCloseCategoryDrawer = useCallback(() => setCategoryDrawerOpen(false), []);

  const onCloseMyPage = useCallback(() => {
    navigate('/');
  }, [navigate]);

  return {
    user,
    selectedCategory,
    selectedContentItem,
    categoryDrawerOpen,
    sidebarItems,
    onSelectCategory,
    onSelectContentItem,
    onOpenCategoryDrawer,
    onCloseCategoryDrawer,
    onCloseMyPage,
  };
}
