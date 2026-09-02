import i18n from '../i18n';

const getLocale = () => (i18n.language && i18n.language.startsWith('en') ? 'en-US' : 'ko-KR');

export const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
};

export const formatDate = (dateString) => {
  if (!dateString) return '-';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  try {
    return date.toLocaleString(getLocale(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    return dateString;
  }
};

/** Date only, for use in components that need locale-aware date display */
export const formatDateOnly = (dateString) => {
  if (!dateString) return '';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return String(dateString);

  try {
    return date.toLocaleDateString(getLocale());
  } catch (error) {
    return String(dateString);
  }
};
