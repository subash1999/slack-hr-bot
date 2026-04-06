/**
 * One-time setup script — creates production + staging Google Sheets and seeds both.
 * Run via GAS editor or clasp run.
 */

import { seedDatabase } from './seed';

/**
 * Creates a new Google Sheet, stores its ID, seeds it, and returns the URL.
 */
function createAndSeedSheet(name: string): string {
  const ss = SpreadsheetApp.create(name);
  const id = ss.getId();
  const url = ss.getUrl();

  Logger.log(`Created sheet: ${name}`);
  Logger.log(`  ID: ${id}`);
  Logger.log(`  URL: ${url}`);

  const report = seedDatabase({ spreadsheet: ss });

  Logger.log(`  Tabs created: ${report.tabsCreated.join(', ')}`);
  Logger.log(`  Policies: ${report.policiesCreated.join(', ')}`);
  Logger.log(`  Positions: ${report.positionsCreated.join(', ')}`);
  Logger.log(`  CEO: ${report.ceoCreated ? 'created' : 'skipped'}`);

  return `${name}\n  ID: ${id}\n  URL: ${url}`;
}

/**
 * Main setup function — creates both production and staging sheets.
 * Run this ONCE. After running, set SHEET_ID in Script Properties to the production ID.
 */
function setupSheets(): string {
  const prod = createAndSeedSheet('Slack HR Bot - Production');
  const staging = createAndSeedSheet('Slack HR Bot - Staging');

  const summary = [
    '=== Setup Complete ===',
    '',
    'PRODUCTION:',
    prod,
    '',
    'STAGING:',
    staging,
    '',
    'Next steps:',
    '1. Go to Apps Script Editor → Project Settings → Script Properties',
    '2. Set SHEET_ID to the Production sheet ID',
    '3. Set STAGING_SHEET_ID to the Staging sheet ID',
    '4. Set SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_VERIFICATION_TOKEN',
  ].join('\n');

  Logger.log(summary);
  return summary;
}

// Export for GAS
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
(globalThis as Record<string, unknown>).setupSheets = setupSheets;
(globalThis as Record<string, unknown>).createAndSeedSheet = createAndSeedSheet;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
