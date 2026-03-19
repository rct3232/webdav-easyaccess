import { useEffect, useState } from 'react';

import { observeElementWidth } from '../../../services/resizeObserverAdapter';

function useObservedElementWidth(initialWidth = 200) {
  const [width, setWidth] = useState(initialWidth);
  const [observedElement, setObservedElement] = useState(null);

  useEffect(() => {
    return observeElementWidth(observedElement, setWidth);
  }, [observedElement]);

  return {
    setObservedElement,
    width,
  };
}

export default useObservedElementWidth;
