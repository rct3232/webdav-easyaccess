import { useTranslation } from 'react-i18next';

const EmailNotificationMessage = () => {
  const { t } = useTranslation();
  return t('emailNotification.message');
};

export default EmailNotificationMessage;
