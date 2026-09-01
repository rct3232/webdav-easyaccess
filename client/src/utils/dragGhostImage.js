/**
 * Converts hex color to rgba with opacity
 * @param {string} hex - Hex color string (e.g., '#1976d2')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
const hexToRgba = (hex, alpha) => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Creates a custom drag ghost element for file drag operations
 * @param {Object} file - The file object being dragged
 * @param {Object} theme - Material-UI theme object for accessing colors
 * @param {number} count - Number of selected items (for multi-selection badge)
 * @returns {HTMLElement} The drag ghost element
 */
export const createDragGhostElement = (file, theme, count = 1) => {
  // Convert primary color to rgba with opacity
  const primaryColor = theme.palette.primary.main;
  const borderColor = hexToRgba(primaryColor, 0.3);

  // Create container
  const container = document.createElement('div');
  container.style.cssText = `
    width: 120px;
    height: 160px;
    background-color: rgba(245, 245, 245, 0.4);
    border: 1px solid ${borderColor};
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    box-sizing: border-box;
    opacity: 0.5;
    position: absolute;
    top: -9999px;
    left: -9999px;
    pointer-events: none;
    font-family: ${theme.typography.fontFamily};
  `;

  // Create thumbnail/icon container (top section)
  const iconContainer = document.createElement('div');
  iconContainer.style.cssText = `
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
    overflow: hidden;
  `;

  // Add thumbnail or icon
  if (file.thumbnailUrl) {
    const img = document.createElement('img');
    img.src = file.thumbnailUrl;
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.7;
    `;
    iconContainer.appendChild(img);
  } else {
    // Create SVG icon based on file type
    const iconSvg = createFileIconSVG(file, theme);
    iconContainer.innerHTML = iconSvg;
  }

  // Create filename label (bottom section)
  const nameLabel = document.createElement('div');
  nameLabel.textContent = file.basename || file.name || 'File';
  nameLabel.style.cssText = `
    width: 100%;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: rgba(96, 96, 96, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
    margin-top: 8px;
  `;

  // Add count badge for multi-selection
  if (count > 1) {
    const badge = document.createElement('div');
    badge.textContent = count.toString();
    badge.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: ${theme.palette.primary.main};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
    container.appendChild(badge);
  }

  // Assemble the container
  container.appendChild(iconContainer);
  container.appendChild(nameLabel);

  return container;
};

/**
 * Creates an SVG icon string based on file type
 * @param {Object} file - The file object
 * @param {Object} theme - Material-UI theme object
 * @returns {string} SVG icon as HTML string
 */
const createFileIconSVG = (file, theme) => {
  const primaryColor = theme.palette.primary.main;
  const textColor = 'rgba(120, 120, 120, 0.7)';

  // Folder icon
  if (file.type === 'directory') {
    return `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="${primaryColor}" style="opacity: 0.7;">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
    `;
  }

  // Image icon
  if (file.mime?.startsWith('image/')) {
    return `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="${textColor}" style="opacity: 0.7;">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
      </svg>
    `;
  }

  // Video icon
  if (file.mime?.startsWith('video/')) {
    return `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="${textColor}" style="opacity: 0.7;">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
        <path d="M10 10.5v5l4-2.5z"/>
      </svg>
    `;
  }

  // Default file icon
  return `
    <svg width="64" height="64" viewBox="0 0 24 24" fill="${textColor}" style="opacity: 0.7;">
      <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
    </svg>
  `;
};

/**
 * Sets up a custom drag image for a drag event
 * @param {DragEvent} event - The drag event
 * @param {Object} file - The file being dragged
 * @param {Object} theme - Material-UI theme object
 * @param {number} count - Number of selected items
 */
export const setupDragGhost = (event, file, theme, count = 1) => {
  const ghostElement = createDragGhostElement(file, theme, count);

  // Temporarily add to DOM (required for setDragImage)
  document.body.appendChild(ghostElement);

  // Set the custom drag image
  // Offset: half width (60px) and half height (80px) for centered cursor
  event.dataTransfer.setDragImage(ghostElement, 60, 80);

  // Clean up after a brief moment
  setTimeout(() => {
    if (ghostElement.parentNode) {
      document.body.removeChild(ghostElement);
    }
  }, 0);
};
