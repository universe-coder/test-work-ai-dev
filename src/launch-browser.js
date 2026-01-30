/**
 * Launch browser only: persistent context (visible). No agent, no API key.
 */

import { BrowserController } from './browser.js';

async function main() {
  const browser = new BrowserController();
  await browser.launch();
  console.log('Browser opened. Close the window or press Ctrl+C to exit.');
  process.on('SIGINT', () => {
    browser.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
