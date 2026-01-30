/**
 * Collects interactive elements from the page and returns a snapshot with numeric ids.
 * No hardcoded site-specific selectors — only tagName, role, text from current DOM.
 * Also collects headings (structure), associated labels for inputs, and main content excerpt.
 */

const MAX_ELEMENTS = 200;
const MAX_CONTENT_CHARS = 1200;
const MAX_HEADINGS = 30;

const collectSnapshotScript = () => {
  const MAX_ELEMENTS = 200;
  const MAX_CONTENT_CHARS = 1200;
  const MAX_HEADINGS = 30;

  function getAssociatedLabelText(el) {
    const id = el.id;
    if (id) {
      const labels = document.querySelectorAll('label[for]');
      for (const label of labels) {
        if (label.htmlFor === id) return (label.textContent || '').trim().slice(0, 80);
      }
    }
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.tagName === 'LABEL') return (parent.textContent || '').trim().slice(0, 80);
      parent = parent.parentElement;
    }
    return '';
  }

  function getStableSelector(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
    const name = (el.getAttribute('name') || '').trim();
    const type = (el.getAttribute('type') || '').trim();
    const parts = [tag];
    if (role) parts.push('[role="' + role + '"]');
    if (name && (tag === 'input' || tag === 'textarea')) parts.push('[name="' + name + '"]');
    if (type && tag === 'input') parts.push('[type="' + type + '"]');
    const selector = parts.join('');
    const all = document.querySelectorAll(selector);
    if (all.length > 1 && text) {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
      return { type: 'xpath', value: '//' + selector + '[contains(normalize-space(.), "' + escaped + '")]' };
    }
    if (all.length > 1) {
      const idx = Array.from(all).indexOf(el);
      return { type: 'nth', selector, index: idx };
    }
    return { type: 'selector', value: selector };
  }

  const interactiveSelector = [
    'a[href]',
    'button',
    '[role="button"]',
    'a[class*="button" i]',
    '[role="switch"]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const seen = new Set();
  const elements = [];
  const root = document.body;
  if (!root) return { url: '', title: '', elements: [], headings: [], contentExcerpt: '' };

  const headings = [];
  const headingTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  root.querySelectorAll(headingTags.join(',')).forEach((h) => {
    if (headings.length >= MAX_HEADINGS) return;
    const text = (h.textContent || '').trim().slice(0, 120);
    if (text) headings.push({ level: parseInt(h.tagName.charAt(1), 10), text });
  });

  let contentExcerpt = '';
  const mainEl = root.querySelector('main, [role="main"]') || root;
  const raw = (mainEl.textContent || '').replace(/\s+/g, ' ').trim();
  if (raw) contentExcerpt = raw.slice(0, MAX_CONTENT_CHARS);

  const walk = (node) => {
    if (elements.length >= MAX_ELEMENTS) return;
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = /** @type {Element} */ (node);
    if (!el.matches || !el.matches(interactiveSelector)) {
      for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
      return;
    }

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const roleAttr = el.getAttribute('role') || '';
    const isButtonLike = roleAttr === 'button' || (el.tagName === 'A' && el.getAttribute('href'));
    const hasLabel = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().length > 0;
    const skipSmall = rect.width < 2 || rect.height < 2;
    if (skipSmall && !(isButtonLike && hasLabel)) {
      for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
      return;
    }
    if (style.visibility === 'hidden' || style.display === 'none') {
      for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
      return;
    }

    const rawInner = (el.innerText || el.textContent || '').trim();
    const text = rawInner.slice(0, 200);
    const titleAttr = (el.getAttribute('title') || '').trim().slice(0, 100);
    const key = `${el.tagName}-${rawInner.slice(0, 50)}-${el.getAttribute('href') || ''}-${rect.top}-${rect.left}`;
    if (seen.has(key)) {
      for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
      return;
    }
    seen.add(key);

    const id = elements.length + 1;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const tagName = el.tagName.toLowerCase();
    const placeholder = (el.getAttribute('placeholder') || '').trim().slice(0, 60);
    const href = (el.getAttribute('href') || '').trim();
    const ariaLabel = (el.getAttribute('aria-label') || '').trim().slice(0, 100);
    const value = (el.value !== undefined ? String(el.value) : '').trim().slice(0, 100);
    const type = (el.getAttribute('type') || '').trim();
    const labelText = (tagName === 'input' || tagName === 'textarea' || tagName === 'select') ? getAssociatedLabelText(el) : '';

    const displayText = text || ariaLabel || titleAttr || value || (placeholder ? `placeholder: ${placeholder}` : '') || (href ? `link: ${href}` : '') || (labelText ? `label: ${labelText}` : '');

    const dialogEl = el.closest && el.closest('[role="dialog"], [role="alertdialog"]');
    const isInDialog = !!dialogEl;
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

    let options;
    if (tagName === 'select' && el.options) {
      const MAX_OPTIONS = 30;
      options = Array.from(el.options).slice(0, MAX_OPTIONS).map((o) => ({ value: o.value || o.text, label: (o.text || '').trim().slice(0, 60) }));
    }

    const stable = getStableSelector(el);
    elements.push({
      id,
      role,
      tagName,
      text: displayText,
      placeholder: placeholder || undefined,
      href: href || undefined,
      value: value || undefined,
      type: type || undefined,
      labelText: labelText || undefined,
      title: titleAttr || undefined,
      selector: stable,
      isInDialog: isInDialog || undefined,
      disabled: disabled || undefined,
      options: options || undefined,
    });

    if (!el.matches('a, button, input, textarea, select, [role="button"], [role="link"]')) {
      for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
    }
  };

  walk(root);
  return {
    url: window.location.href,
    title: document.title || '',
    elements,
    headings,
    contentExcerpt,
  };
};

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<{ url: string; title: string; elements: Array<{ id: number; role: string; tagName: string; text: string; placeholder?: string; href?: string; value?: string; type?: string; labelText?: string; title?: string; selector: unknown }>; headings: Array<{ level: number; text: string }>; contentExcerpt: string }>}
 */
export async function getPageSnapshot(page) {
  const snapshot = await page.evaluate(collectSnapshotScript);
  return snapshot;
}

/**
 * Format snapshot for LLM prompt (compact text).
 * @param {{ url: string; title: string; elements: Array<{ id: number; role: string; tagName: string; text: string; placeholder?: string; href?: string; value?: string; type?: string; labelText?: string }>; headings?: Array<{ level: number; text: string }>; contentExcerpt?: string; tabs?: Array<{ index: number; url: string; title: string }>; activeTabIndex?: number }} snapshot
 */
export function formatSnapshotForPrompt(snapshot) {
  const lines = [];

  if (snapshot.tabs?.length) {
    const active = snapshot.activeTabIndex ?? 0;
    lines.push('Tabs (current tab marked with *):');
    for (const t of snapshot.tabs) {
      const mark = t.index === active ? '*' : ' ';
      const title = (t.title || '(no title)').slice(0, 50);
      const url = (t.url || 'about:blank').slice(0, 70);
      lines.push(`  ${t.index}${mark}: ${title} — ${url}`);
    }
    lines.push('');
  }

  lines.push(`URL: ${snapshot.url}`, `Title: ${snapshot.title}`, '');

  if (snapshot.headings?.length) {
    lines.push('Structure (headings):');
    for (const h of snapshot.headings) {
      lines.push('  ' + '#'.repeat(h.level) + ' ' + h.text);
    }
    lines.push('');
  }

  if (snapshot.contentExcerpt) {
    lines.push('Page content (excerpt):');
    lines.push(snapshot.contentExcerpt);
    lines.push('');
  }

  lines.push('Interactive elements (use id to click or type):');
  for (const el of snapshot.elements) {
    let desc = `  ${el.id}. [${el.tagName}` + (el.type ? ` type=${el.type}` : '') + ']';
    if (el.role === 'button') desc += ' (button)';
    if (el.isInDialog) desc += ' (in modal/dialog)';
    if (el.disabled) desc += ' (disabled)';
    if (el.labelText) desc += ` label="${el.labelText}"`;
    if (el.text) desc += ` "${el.text.slice(0, 100)}"`;
    if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
    if (el.value !== undefined && el.value !== '') desc += ` value="${String(el.value).slice(0, 50)}"`;
    if (el.href) desc += ` href="${el.href.slice(0, 60)}"`;
    if (el.options?.length) {
      const opts = el.options.map((o) => o.label || o.value).filter(Boolean).slice(0, 15);
      desc += ` options: ${opts.join(', ')}${el.options.length > 15 ? '…' : ''}`;
    }
    lines.push(desc);
  }
  if (snapshot.elements.length >= MAX_ELEMENTS) {
    lines.push(`  ... (page truncated to ${MAX_ELEMENTS} elements)`);
  }
  return lines.join('\n');
}
