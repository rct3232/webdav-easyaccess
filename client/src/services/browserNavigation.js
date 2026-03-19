function getDefaultOpenWindow() {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return null;
  }

  return window.open.bind(window);
}

function openUrlInNewTab(url, openWindow = getDefaultOpenWindow()) {
  if (typeof openWindow !== 'function') {
    return;
  }

  openWindow(url, '_blank', 'noopener,noreferrer');
}

export { openUrlInNewTab };
