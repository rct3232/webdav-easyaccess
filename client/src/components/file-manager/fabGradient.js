/**
 * Shared FAB gradient fills — the single source of the AppBar/FAB palette used
 * by the FAB itself and by any surface that morphs INTO the FAB slot (the
 * search button shows the gradient on hover). Background strings only; size
 * and hover composition stay at the consumer so each surface controls geometry.
 * @see docs/spec/client/components/file-manager/FloatingSearchBar.md §2.5
 */

export const FAB_GRADIENT_BACKGROUND = `
  radial-gradient(ellipse 250px 150px at 0% 0%, #4167ba 0%, transparent 60%),
  radial-gradient(ellipse 250px 150px at 50% 100%, #52c597 0%, transparent 60%),
  radial-gradient(ellipse 300px 200px at 100% 15%, rgba(251, 229, 89, 0.6) 0%, transparent 40%),
  linear-gradient(135deg, #4167ba, #52c597 85%, rgba(251, 229, 89, 0.5) 98%)
`.trim();

export const FAB_GRADIENT_BACKGROUND_HOVER = `
  radial-gradient(ellipse 250px 150px at 0% 0%, #4167ba 0%, transparent 60%),
  radial-gradient(ellipse 250px 150px at 50% 100%, #52c597 0%, transparent 60%),
  radial-gradient(ellipse 180px 100px at 100% 30%, #fbe559 0%, transparent 50%),
  linear-gradient(135deg, #4167ba, #52c597 80%, #fbe559 95%)
`.trim();
