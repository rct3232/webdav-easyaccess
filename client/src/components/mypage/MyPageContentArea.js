import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MyPageContentPanel from './MyPageContentPanel';
import { getMyPageContentDescriptor } from '../../utils/myPageRegistry';

const MyPageContentArea = ({
  selectedCategory,
  selectedContentItem,
  onSelectContentItem,
  user,
  onMessage,
}) => {
  // The Storage dashboard's deep-link seam lives here (not in the pure
  // registry helper): the page-level router hook stays out of registry data.
  const navigate = useNavigate();
  const onNavigate = useCallback((route) => navigate(route), [navigate]);

  const { categoryIcon, onBack, ContentComponent, contentProps } = getMyPageContentDescriptor({
    selectedCategory,
    selectedContentItem,
    onSelectContentItem,
    user,
    onMessage,
    onNavigate,
  });

  return (
    <MyPageContentPanel onBack={onBack} categoryIcon={categoryIcon}>
      {ContentComponent ? <ContentComponent {...contentProps} /> : null}
    </MyPageContentPanel>
  );
};

export default MyPageContentArea;
