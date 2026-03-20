function getElementWidth(element) {
  if (!element) {
    return 0;
  }

  if (typeof element.getBoundingClientRect === 'function') {
    return element.getBoundingClientRect().width;
  }

  return element.clientWidth || 0;
}

function observeElementWidth(element, onWidthChange) {
  if (!element || typeof onWidthChange !== 'function') {
    return () => {};
  }

  const reportCurrentWidth = () => {
    const width = getElementWidth(element);
    if (width > 0) {
      onWidthChange(width);
    }
  };

  reportCurrentWidth();

  if (typeof ResizeObserver === 'undefined') {
    return () => {};
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry?.contentRect?.width ?? getElementWidth(element);
      if (width > 0) {
        onWidthChange(width);
      }
    }
  });

  observer.observe(element);

  let disconnected = false;

  return () => {
    if (disconnected) {
      return;
    }

    disconnected = true;
    observer.disconnect();
  };
}

export { observeElementWidth };
