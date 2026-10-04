/** Split the remaining rows equally among visible panels, preserving a preview
 * when a share cannot fit that panel's minimum expanded presentation. */
export function allocatePanelHeights(
  availableRows: number,
  minimumExpandedHeights: readonly number[],
): number[] {
  if (minimumExpandedHeights.length === 0) return [];
  const share = Math.max(1, Math.floor(availableRows / minimumExpandedHeights.length));
  return minimumExpandedHeights.map((minimum) => (share < minimum ? 1 : share));
}
