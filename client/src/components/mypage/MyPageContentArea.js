import React from 'react';
import MyPageContentPanel from './MyPageContentPanel';
import { getMyPageContentDescriptor } from '../../utils/myPageRegistry';

const MyPageContentArea = ({ selectedCategory, selectedContentItem, onSelectContentItem, user, onMessage }) => {
  const {
    categoryIcon,
    onBack,
    ContentComponent,
    contentProps,
  } = getMyPageContentDescriptor({
    selectedCategory,
    selectedContentItem,
    onSelectContentItem,
    user,
    onMessage,
  });

  return (
    <MyPageContentPanel onBack={onBack} categoryIcon={categoryIcon}>
      {ContentComponent ? <ContentComponent {...contentProps} /> : null}
    </MyPageContentPanel>
  );
};

export default MyPageContentArea;
