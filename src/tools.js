/**
 * OpenAI tool definitions and execution. No hardcoded site hints — agent decides from page snapshot.
 */

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate the current tab to a URL. Use when you need to open a new site or page in the active tab.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to open (e.g. https://example.com)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_new_tab',
      description: 'Open a new browser tab. Optionally navigate it to a URL. The new tab becomes active. Use for multi-site workflows (e.g. keep one site in tab 0, open another in tab 1).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Optional. URL to open in the new tab. If omitted, new tab is blank.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch to another tab by its index (0-based). The snapshot shows "Tabs" with indices; use the index of the tab you want to work in. All subsequent actions apply to that tab until you switch again.',
      parameters: {
        type: 'object',
        properties: {
          tab_index: { type: 'integer', description: '0-based tab index from the Tabs list (e.g. 0 for first tab, 1 for second)' },
        },
        required: ['tab_index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Click a button, link, or other interactive element by its id from the snapshot. Do not use for elements marked "(disabled)" — fill required fields first or wait. Prefer the element whose text/label matches the action (e.g. Submit, Send, Close).',
      parameters: {
        type: 'object',
        properties: {
          element_id: { type: 'integer', description: 'Numeric id of the element from the snapshot (e.g. 5)' },
        },
        required: ['element_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input/textarea. Either specify element_id from snapshot, or omit to type into the currently focused field.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
          element_id: { type: 'integer', description: 'Optional. Id of input/textarea from snapshot. If omitted, types into focused element.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: 'Select an option in a <select> dropdown by value or by visible label. Use element_id of the select from the snapshot; options are listed in the element description.',
      parameters: {
        type: 'object',
        properties: {
          element_id: { type: 'integer', description: 'Id of the select element from the snapshot' },
          value_or_label: { type: 'string', description: 'Option value (attribute) or visible label text' },
        },
        required: ['element_id', 'value_or_label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_checkbox',
      description: 'Set checkbox or radio button checked state. Use for input type=checkbox or type=radio.',
      parameters: {
        type: 'object',
        properties: {
          element_id: { type: 'integer', description: 'Id of the checkbox/radio from the snapshot' },
          checked: { type: 'boolean', description: 'true to check, false to uncheck' },
        },
        required: ['element_id', 'checked'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page to see more content.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for dynamic content to load, animations to finish, or after form submit to see result. Use after navigation, after a click that opens overlay/modal, or after submitting a form to see success/validation messages.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Seconds to wait (1–10)' },
        },
        required: ['seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description: 'Call when the user task is fully completed. Provide a brief result summary.',
      parameters: {
        type: 'object',
        properties: {
          result: { type: 'string', description: 'Brief summary of what was done' },
        },
        required: ['result'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_user_input',
      description: 'Call when you need additional information from the user to proceed (e.g. choice, confirmation, password).',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question or prompt for the user' },
        },
        required: ['question'],
      },
    },
  },
];

/**
 * Execute a tool by name with given args. Uses current snapshot and browser controller.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ snapshot: { elements: Array<{ id: number; selector: unknown }> }; browser: import('./browser.js').BrowserController }} context
 * @returns {Promise<{ success: boolean; message: string; stop?: boolean; userQuestion?: string }>}
 */
export async function executeTool(name, args, context) {
  const { snapshot, browser } = context;

  switch (name) {
    case 'navigate': {
      const url = args.url;
      if (typeof url !== 'string') return { success: false, message: 'url must be a string' };
      await browser.navigate(url);
      return { success: true, message: 'Navigated to ' + url };
    }
    case 'open_new_tab': {
      const url = args.url;
      try {
        await browser.newTab(typeof url === 'string' ? url : undefined);
        const pages = browser.getPages();
        const idx = pages.length - 1;
        return {
          success: true,
          message: url ? `Opened new tab ${idx} and navigated to ${url}` : `Opened new tab ${idx} (blank). Use navigate(url) to go to a page.`,
        };
      } catch (err) {
        return { success: false, message: String(err?.message || err) };
      }
    }
    case 'switch_tab': {
      const tabIndex = args.tab_index;
      if (typeof tabIndex !== 'number') return { success: false, message: 'tab_index must be a number' };
      try {
        await browser.switchTab(tabIndex);
        return { success: true, message: 'Switched to tab ' + tabIndex };
      } catch (err) {
        return { success: false, message: String(err?.message || err) };
      }
    }
    case 'click_element': {
      const elementId = args.element_id;
      if (typeof elementId !== 'number') return { success: false, message: 'element_id must be a number' };
      const targetEl = snapshot.elements?.find((e) => e.id === elementId);
      if (targetEl) {
        const label = [targetEl.text, targetEl.href].filter(Boolean).join(' | ') || '(no label)';
        console.log('[click_element] id=%d selector=%s label=%s', elementId, JSON.stringify(targetEl.selector), label.slice(0, 80));
      }
      if (targetEl?.disabled) {
        return {
          success: false,
          message: 'Element is disabled. Fill required fields or wait for it to become enabled, then try again.',
        };
      }
      try {
        await browser.clickElement(snapshot, elementId);
        return { success: true, message: 'Clicked element ' + elementId };
      } catch (err) {
        const msg = String(err?.message || err);
        return {
          success: false,
          message: msg + '. Try scroll(down) to bring the element into view, then wait(2), then click again; or the element may have changed (re-check snapshot).',
        };
      }
    }
    case 'type_text': {
      const text = args.text;
      const elementId = args.element_id;
      if (typeof text !== 'string') return { success: false, message: 'text must be a string' };
      try {
        await browser.typeText(snapshot, typeof elementId === 'number' ? elementId : null, text);
        return { success: true, message: 'Typed text into ' + (elementId != null ? 'element ' + elementId : 'focused field') };
      } catch (err) {
        return { success: false, message: String(err?.message || err) };
      }
    }
    case 'select_option': {
      const elementId = args.element_id;
      const valueOrLabel = args.value_or_label;
      if (typeof elementId !== 'number') return { success: false, message: 'element_id must be a number' };
      if (typeof valueOrLabel !== 'string') return { success: false, message: 'value_or_label must be a string' };
      try {
        await browser.selectOption(snapshot, elementId, valueOrLabel);
        return { success: true, message: 'Selected "' + valueOrLabel + '" in element ' + elementId };
      } catch (err) {
        return { success: false, message: String(err?.message || err) };
      }
    }
    case 'set_checkbox': {
      const elementId = args.element_id;
      const checked = args.checked;
      if (typeof elementId !== 'number') return { success: false, message: 'element_id must be a number' };
      if (typeof checked !== 'boolean') return { success: false, message: 'checked must be a boolean' };
      try {
        await browser.setCheckbox(snapshot, elementId, checked);
        return { success: true, message: (checked ? 'Checked' : 'Unchecked') + ' element ' + elementId };
      } catch (err) {
        return { success: false, message: String(err?.message || err) };
      }
    }
    case 'scroll': {
      const direction = args.direction;
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        return { success: false, message: 'direction must be up, down, left, or right' };
      }
      await browser.scroll(direction);
      return { success: true, message: 'Scrolled ' + direction };
    }
    case 'wait': {
      const sec = Math.min(10, Math.max(1, Number(args.seconds) || 2));
      await new Promise((r) => setTimeout(r, sec * 1000));
      return { success: true, message: 'Waited ' + sec + ' seconds' };
    }
    case 'task_done': {
      const result = args.result;
      return { success: true, message: typeof result === 'string' ? result : 'Done', stop: true };
    }
    case 'request_user_input': {
      const question = args.question;
      return {
        success: true,
        message: typeof question === 'string' ? question : 'Need your input',
        stop: true,
        userQuestion: typeof question === 'string' ? question : undefined,
      };
    }
    default:
      return { success: false, message: 'Unknown tool: ' + name };
  }
}
