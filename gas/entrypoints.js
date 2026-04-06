/**
 * GAS entry point wrappers — these top-level functions are discoverable
 * by the Apps Script editor. They delegate to the bundled code.
 */

function doPost(e) {
  return globalThis.doPost(e);
}

function keepAlive() {
  return globalThis.keepAlive();
}

function seedDatabase() {
  return globalThis.seedDatabase();
}

function setupSheets() {
  return globalThis.setupSheets();
}

function createAndSeedSheet(name) {
  return globalThis.createAndSeedSheet(name);
}
