/**
 * Typed GAS service mocks for Jest testing.
 */

import type { ISheetsService, ISlackService, SheetData, SheetRow, SlackMessage, SlackBlock } from '../../src/types';

export interface MockSheetsService extends ISheetsService {
  _tabData: Record<string, SheetData>;
  _appendedRows: Record<string, SheetRow[]>;
}

export function createMockSheetsService(
  tabData: Record<string, SheetData> = {},
): MockSheetsService {
  const appendedRows: Record<string, SheetRow[]> = {};

  return {
    _tabData: tabData,
    _appendedRows: appendedRows,

    getAll: jest.fn((tabName: string): SheetData => {
      const data = tabData[tabName];
      if (!data) throw new Error(`Sheet not found: ${tabName}`);
      return data;
    }),

    appendRow: jest.fn((tabName: string, row: SheetRow): void => {
      if (!tabData[tabName]) throw new Error(`Sheet not found: ${tabName}`);
      tabData[tabName].push(row);
      if (!appendedRows[tabName]) appendedRows[tabName] = [];
      appendedRows[tabName].push(row);
    }),

    updateCell: jest.fn((tabName: string, rowIndex: number, colIndex: number, value: unknown): void => {
      if (!tabData[tabName]) throw new Error(`Sheet not found: ${tabName}`);
      const row = tabData[tabName][rowIndex - 1];
      if (row) {
        (row as unknown[])[colIndex - 1] = value;
      }
    }),

    invalidateCache: jest.fn(),
    invalidateAllCaches: jest.fn(),
  };
}

export interface MockSlackService extends ISlackService {
  _calls: {
    postToResponseUrl: Array<{ url: string; message: SlackMessage }>;
    postToChannel: Array<{ channel: string; text: string; blocks?: SlackBlock[] }>;
    sendDM: Array<{ userId: string; text: string }>;
    openModal: Array<{ triggerId: string; view: Record<string, unknown> }>;
    updateMessage: Array<{ url: string; message: SlackMessage }>;
  };
}

export function createMockSlackService(): MockSlackService {
  const calls: MockSlackService['_calls'] = {
    postToResponseUrl: [],
    postToChannel: [],
    sendDM: [],
    openModal: [],
    updateMessage: [],
  };

  return {
    _calls: calls,

    postToResponseUrl: jest.fn((url: string, message: SlackMessage): boolean => {
      calls.postToResponseUrl.push({ url, message });
      return true;
    }),

    postToChannel: jest.fn((channel: string, text: string, blocks?: SlackBlock[]): unknown => {
      calls.postToChannel.push({ channel, text, blocks });
      return { ok: true };
    }),

    sendDM: jest.fn((userId: string, text: string): unknown => {
      calls.sendDM.push({ userId, text });
      return { ok: true };
    }),

    openModal: jest.fn((triggerId: string, view: Record<string, unknown>): unknown => {
      calls.openModal.push({ triggerId, view });
      return { ok: true };
    }),

    updateMessage: jest.fn((url: string, message: SlackMessage): void => {
      calls.updateMessage.push({ url, message });
    }),

    getUserTimezoneOffset: jest.fn((): number | null => {
      return null; // Default: use system default TZ
    }),
  };
}
