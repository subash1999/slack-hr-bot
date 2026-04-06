/**
 * Safe auto-increment ID generation.
 * Scans existing IDs in a column and returns the next sequential ID.
 * Pattern: PREFIX + zero-padded number (e.g., EMP005, LR0042, FLG0003)
 */

import type { SheetData } from '../types';

/**
 * Generate the next ID by scanning existing data for the max numeric suffix.
 * @param prefix - ID prefix (e.g., 'EMP', 'LR', 'FLG', 'SH', 'PA', 'QRP')
 * @param data - Full sheet data including header row
 * @param idColumnIndex - 0-based column index containing IDs
 * @param padLength - Zero-pad length (default 4, e.g., EMP0005)
 */
export function nextId(
  prefix: string,
  data: SheetData,
  idColumnIndex: number,
  padLength = 4,
): string {
  let maxNum = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idColumnIndex]);
    const match = id.match(pattern);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }

  return `${prefix}${String(maxNum + 1).padStart(padLength, '0')}`;
}
