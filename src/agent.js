/**
 * Agent loop: get snapshot → LLM with tool calling → execute tool → repeat until task_done or request_user_input.
 * Uses sub-agent prompts, security layer for destructive actions, and error-adaptation.
 */

import { formatSnapshotForPrompt } from './pageSnapshot.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { checkDestructiveAction } from './security.js';
import { classifyTask, SUB_AGENT_PROMPTS } from './subAgents.js';

function logToolCall(name, args) {
  const parts = Object.entries(args)
    .map(([k, v]) => {
      const s = typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '...' : String(v);
      return `${k}=${JSON.stringify(s)}`;
    })
    .join(', ');
  console.log('[Agent]', name, parts ? `(${parts})` : '');
}

const MAX_ITERATIONS = 80;
const MODEL = 'gpt-4o-mini';

/**
 * @param {{ openai: import('openai').OpenAI; browser: import('./browser.js').BrowserController; getUserConfirmation?: (description: string) => Promise<boolean> }} deps
 * @param {string} userTask
 * @returns {Promise<{ done: boolean; result?: string; userQuestion?: string; error?: string }>}
 */
export async function runAgent(deps, userTask) {
  const { openai, browser, getUserConfirmation } = deps;

  const taskType = await classifyTask(openai, userTask);
  const systemPrompt = SUB_AGENT_PROMPTS[taskType] ?? SUB_AGENT_PROMPTS.default;
  console.log('[Agent] Task type:', taskType);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Current task from user: ' + userTask + '\n\nWhat is the current state of the page? Decide the next action. If you see a blank page or no relevant content, navigate first. Otherwise use the element ids from the snapshot below.' },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const snapshot = await browser.getSnapshot();
    const snapshotText = formatSnapshotForPrompt(snapshot);
    const stateMessage = {
      role: 'user',
      content: 'Current page state:\n\n' + snapshotText,
    };
    if (i === 0) {
      messages[1].content += '\n\n' + stateMessage.content;
    } else {
      messages.push(stateMessage);
    }

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOL_DEFINITIONS.length ? TOOL_DEFINITIONS : undefined,
      tool_choice: 'auto',
    });

    const choice = response.choices?.[0];
    if (!choice) {
      return { done: false, error: 'No response from model' };
    }

    const finishReason = choice.finish_reason;
    const toolCalls = choice.message?.tool_calls;

    if (finishReason === 'stop' && !toolCalls?.length) {
      messages.push({ role: 'assistant', content: choice.message?.content || '(no content)' });
      continue;
    }

    if (toolCalls?.length) {
      const toolCall = toolCalls[0];
      const name = toolCall.function?.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (_) {
        args = {};
      }
      logToolCall(name, args);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: { name, arguments: toolCall.function?.arguments || '{}' },
          },
        ],
      });

      const security = checkDestructiveAction(name, args, snapshot);
      let result;
      if (security.destructive && getUserConfirmation) {
        const allowed = await getUserConfirmation(security.description ?? 'Sensitive action');
        if (!allowed) {
          result = { success: false, message: 'User denied the action.' };
        } else {
          result = await executeTool(name, args, { snapshot, browser });
        }
      } else {
        result = await executeTool(name, args, { snapshot, browser });
      }

      const toolContent = result.success ? result.message : 'Error: ' + result.message;
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });

      if (result.stop) {
        if (name === 'task_done') {
          console.log('[Agent] Finished. Result:', result.message);
        } else if (name === 'request_user_input') {
          console.log('[Agent] Asking user:', result.userQuestion || result.message);
        }
        return {
          done: true,
          result: result.message,
          userQuestion: result.userQuestion,
        };
      }
      continue;
    }

    messages.push({
      role: 'assistant',
      content: choice.message?.content || '',
    });
  }

  return { done: false, error: 'Max iterations reached' };
}
