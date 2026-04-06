/**
 * Sheets Service — centralized Google Sheets read/write with locking and caching.
 */

import { CACHED_TABS, CACHE_TTL_SECONDS, LOCK_TIMEOUT_MS } from '../config';
import type { ISheetsService, SheetData, SheetRow } from '../types';

export interface SheetsDeps {
  SpreadsheetApp: GoogleAppsScript.Spreadsheet.SpreadsheetApp;
  CacheService: GoogleAppsScript.Cache.CacheService;
  LockService: GoogleAppsScript.Lock.LockService;
  sheetId: string;
}

export function createSheetsService(deps: SheetsDeps): ISheetsService {
  const ss = deps.SpreadsheetApp.openById(deps.sheetId);
  const cache = deps.CacheService.getScriptCache();
  if (cache === null) throw new Error('CacheService unavailable');

  function getAll(tabName: string): SheetData {
    if (CACHED_TABS.includes(tabName)) {
      const cached = cache.get(`tab_${tabName}`);
      if (cached !== null && cached !== '') {
        return JSON.parse(cached) as SheetData;
      }
    }

    const sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error(`Sheet not found: ${tabName}`);
    const data = sheet.getDataRange().getValues() as SheetData;

    if (CACHED_TABS.includes(tabName)) {
      try {
        cache.put(`tab_${tabName}`, JSON.stringify(data), CACHE_TTL_SECONDS);
      } catch (_e) {
        // Cache put can fail if data > 100KB — continue silently
      }
    }

    return data;
  }

  function withLock<T>(fn: () => T): T {
    const lock = deps.LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      throw new Error('System is busy, please try again in a few seconds.');
    }
    try {
      const result = fn();
      deps.SpreadsheetApp.flush();
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  function appendRow(tabName: string, row: SheetRow): void {
    withLock(() => {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) throw new Error(`Sheet not found: ${tabName}`);
      sheet.appendRow(row);
    });
    if (CACHED_TABS.includes(tabName)) {
      cache.remove(`tab_${tabName}`);
    }
  }

  function updateCell(
    tabName: string,
    rowIndex: number,
    colIndex: number,
    value: unknown,
  ): void {
    withLock(() => {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) throw new Error(`Sheet not found: ${tabName}`);
      sheet.getRange(rowIndex, colIndex).setValue(value);
    });
    if (CACHED_TABS.includes(tabName)) {
      cache.remove(`tab_${tabName}`);
    }
  }

  function invalidateCache(tabName: string): void {
    cache.remove(`tab_${tabName}`);
  }

  function invalidateAllCaches(): void {
    for (const tab of CACHED_TABS) {
      cache.remove(`tab_${tab}`);
    }
  }

  return { getAll, appendRow, updateCell, invalidateCache, invalidateAllCaches };
}
