/**
 * Entry point: launch visible browser with persistent session, read task from CLI, run agent.
 */

import 'dotenv/config';
import * as readline from 'readline';
import OpenAI from 'openai';
import { BrowserController } from './browser.js';
import { runAgent } from './agent.js';

async function promptTask() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Enter task for the agent (or Ctrl+C to exit): ', (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Set OPENAI_API_KEY in .env (see .env.example)');
    process.exit(1);
  }

  const interactive = process.env.INTERACTIVE === '1' || process.env.INTERACTIVE === 'true';
  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n--- Интерактивный режим ---');
    console.log('Разместите это окно консоли на ЛЕВОЙ половине экрана.');
    console.log('Браузер откроется на правой половине. Нажмите Enter для продолжения.\n');
    await new Promise((resolve) => rl.question('Готовы? Enter... ', () => { rl.close(); resolve(); }));
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const task = await promptTask();
  if (!task) {
    console.log('No task entered. Exiting.');
    process.exit(0);
  }

  async function getUserConfirmation(description) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`\n--- Security: Agent wants to do: "${description}". Allow? (yes/no): `, (answer) => {
        rl.close();
        resolve(/^y|yes|да|д$/i.test((answer || '').trim()));
      });
    });
  }

  const browser = new BrowserController();
  try {
    await browser.launch(interactive ? { halfScreen: true, side: 'right' } : {});
    console.log('Browser opened. Agent is working...');
    const result = await runAgent({ openai, browser, getUserConfirmation }, task);
    if (result.done) {
      if (result.userQuestion) {
        console.log('\n--- Agent asks ---\n' + result.userQuestion);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((res) => rl.question('Your answer: ', res));
        rl.close();
        console.log('Re-run the app to continue, or complete the task manually in the browser.');
      } else {
        console.log('\n--- Result ---\n' + (result.result || 'Task completed.'));
      }
    } else {
      console.error('\nStopped:', result.error || 'Unknown error');
    }
  } finally {
    console.log('Browser remains open. Close it manually or run the app again for a new task.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
