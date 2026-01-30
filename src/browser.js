/**
 * Playwright browser wrapper: persistent context (visible), navigate, click by id, type, scroll.
 */

import { chromium } from 'playwright';
import { getPageSnapshot } from './pageSnapshot.js';
import { getScreenSize } from './screenSize.js';

const USER_DATA_DIR = './browser-data';
const ACTION_DELAY_MS = 500;
const CLICK_AFTER_DELAY_MS = 1200;

/**
 * Resolve Playwright locator from snapshot element selector descriptor.
 * @param {import('playwright').Page} page
 * @param {{ type: string; value?: string; selector?: string; index?: number }} selectorDesc
 */
function locatorFromSelector(page, selectorDesc) {
  if (selectorDesc.type === 'xpath' && selectorDesc.value) {
    return page.locator('xpath=' + selectorDesc.value).first();
  }
  if (selectorDesc.type === 'nth' && selectorDesc.selector != null && selectorDesc.index != null) {
    return page.locator(selectorDesc.selector).nth(selectorDesc.index);
  }
  if (selectorDesc.type === 'selector' && selectorDesc.value) {
    return page.locator(selectorDesc.value).first();
  }
  throw new Error('Invalid selector descriptor: ' + JSON.stringify(selectorDesc));
}

/**
 * Find element in page by selector descriptor; optional fallback by visible text.
 * @param {import('playwright').Page} page
 * @param {{ type: string; value?: string; selector?: string; index?: number }} selectorDesc
 * @param {string} [expectedText] - if selector fails, find clickable whose text contains this (first 40 chars)
 */
async function clickViaEvaluate(page, selectorDesc, expectedText) {
  await page.evaluate(
    ({ desc, textHint }) => {
      function findBySelector() {
        let el = null;
        if (desc.type === 'xpath' && desc.value) {
          el = document.evaluate(desc.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        } else if (desc.type === 'nth' && desc.selector != null && desc.index != null) {
          const list = document.querySelectorAll(desc.selector);
          el = list[desc.index] || null;
        } else if (desc.type === 'selector' && desc.value) {
          el = document.querySelector(desc.value);
        }
        return el;
      }

      function findByText() {
        if (!textHint || textHint.length < 2) return null;
        const hint = textHint.trim().toLowerCase().slice(0, 50);
        const candidates = document.querySelectorAll('a[href], button, [role="button"], [role="link"]');
        for (const c of candidates) {
          const t = (c.innerText || c.textContent || '').trim().toLowerCase();
          if (t && t.includes(hint)) return c;
          const h = (c.getAttribute('href') || '').toLowerCase();
          if (h && hint.length >= 5 && h.includes(hint)) return c;
        }
        return null;
      }

      function findByDataQa() {
        if (!textHint || textHint.length < 2) return null;
        const hint = textHint.trim().toLowerCase().slice(0, 50);
        const cards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        for (const c of cards) {
          const t = (c.innerText || c.textContent || '').trim().toLowerCase();
          if (t && t.includes(hint)) return c;
        }
        return null;
      }

      let el = findBySelector();
      if (!el && textHint) el = findByText();
      if (!el && textHint) el = findByDataQa();
      if (!el || typeof el.click !== 'function') throw new Error('Element not found or not clickable');

      const tag = el.tagName.toUpperCase();
      if (tag !== 'A' && tag !== 'BUTTON' && tag !== 'INPUT') {
        const innerLink = el.querySelector('a[href]');
        if (innerLink) el = innerLink;
        else {
          const parentLink = el.closest ? el.closest('a[href]') : null;
          if (parentLink) el = parentLink;
        }
      }

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();

      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const coord = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, detail: 1 };

      el.dispatchEvent(new PointerEvent('pointerdown', { ...coord, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...coord, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', coord));
      el.dispatchEvent(new MouseEvent('mouseup', coord));
      el.dispatchEvent(new MouseEvent('click', coord));
      el.click();
    },
    { desc: selectorDesc, textHint: expectedText ? String(expectedText).slice(0, 40) : '' }
  );
}

/**
 * @param {{ url: string; title: string; elements: Array<{ id: number; selector: unknown }> }} snapshot
 * @param {number} id
 */
function findElementInSnapshot(snapshot, id) {
  const el = snapshot.elements.find((e) => e.id === id);
  if (!el) throw new Error('Element id not found in snapshot: ' + id);
  return el;
}

export class BrowserController {
  /** @type {import('playwright').BrowserContext | null} */
  #context = null;
  /** @type {import('playwright').Page | null} */
  #page = null;

  /**
   * Attach dialog handler so alert/confirm/prompt don't block execution (accepted by default).
   * @param {import('playwright').Page} page
   */
  #attachDialogHandler(page) {
    page.on('dialog', (dialog) => dialog.accept());
  }

  /**
   * Launch persistent context (visible browser). Reuse existing page or create new.
   * @param {{ halfScreen?: boolean; side?: 'left' | 'right' }} [options] - halfScreen: place window on half of screen; side: which half (default 'right')
   */
  async launch(options = {}) {
    const { halfScreen = false, side = 'right' } = options;
    let viewport = { width: 1280, height: 800 };
    const args = ['--no-sandbox'];

    if (halfScreen) {
      const { width: sw, height: sh } = await getScreenSize();
      const halfW = Math.floor(sw / 2);
      const halfH = Math.max(600, sh - 80);
      viewport = { width: halfW, height: halfH };
      const x = side === 'right' ? halfW : 0;
      args.push(`--window-position=${x},0`, `--window-size=${halfW},${halfH}`);
    }

    this.#context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport,
      args,
    });
    const context = this.#context;
    for (const p of context.pages()) this.#attachDialogHandler(p);
    context.on('page', (p) => this.#attachDialogHandler(p));
    const pages = context.pages();
    if (pages.length > 0) {
      this.#page = pages[0];
    } else {
      this.#page = await context.newPage();
    }
    return this.#page;
  }

  /**
   * @returns {import('playwright').Page}
   */
  getPage() {
    if (!this.#page) throw new Error('Browser not launched');
    return this.#page;
  }

  /**
   * @returns {import('playwright').Page[]}
   */
  getPages() {
    if (!this.#context) throw new Error('Browser not launched');
    return this.#context.pages();
  }

  /**
   * Open a new tab. Optionally navigate to url. New tab becomes active.
   * @param {string} [url]
   */
  async newTab(url) {
    const context = this.#context;
    if (!context) throw new Error('Browser not launched');
    this.#page = await context.newPage();
    if (url) {
      await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.#page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    await this.#delay();
    return this.#page;
  }

  /**
   * Switch active tab by index (0-based). All actions then apply to that tab.
   * @param {number} tabIndex
   */
  async switchTab(tabIndex) {
    const pages = this.getPages();
    if (tabIndex < 0 || tabIndex >= pages.length) {
      throw new Error('Invalid tab index: ' + tabIndex + ' (tabs: 0–' + (pages.length - 1) + ')');
    }
    this.#page = pages[tabIndex];
    await this.#page.bringToFront();
    await this.#delay();
  }

  /**
   * Get current page snapshot plus list of all tabs (URL, title) and active tab index.
   * Handles navigation: if context is destroyed, waits for load and retries.
   */
  async getSnapshot() {
    const page = this.getPage();
    const pages = this.getPages();
    const activeIndex = pages.indexOf(page);

    const tabs = await Promise.all(
      pages.map(async (p, i) => {
        try {
          return { index: i, url: p.url(), title: await p.title() };
        } catch (_) {
          return { index: i, url: '(navigating)', title: '(loading)' };
        }
      })
    );

    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});

    let pageSnapshot;
    try {
      pageSnapshot = await getPageSnapshot(page);
    } catch (err) {
      if (/Execution context was destroyed|Target closed/i.test(String(err?.message))) {
        await this.#delay();
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        pageSnapshot = await getPageSnapshot(page);
      } else {
        throw err;
      }
    }

    return { ...pageSnapshot, tabs, activeTabIndex: activeIndex };
  }

  /**
   * Navigate to URL. Waits for DOM then optionally for network idle (dynamic content).
   * @param {string} url
   */
  async navigate(url) {
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.#delay();
  }

  /**
   * Click element by id from the given snapshot. Tries Playwright (normal → force) first so hh.ru
   * and similar sites get a real mouse click; on failure uses JS click with inner/parent link resolution.
   * @param {{ url: string; title: string; elements: Array<{ id: number; selector: unknown; role?: string; tagName?: string; text?: string }> }} snapshot
   * @param {number} elementId
   */
  async clickElement(snapshot, elementId) {
    const el = findElementInSnapshot(snapshot, elementId);
    const page = this.getPage();
    const selectorDesc = /** @type {{ type: string; value?: string; selector?: string; index?: number }} */ (el.selector);
    const textHint = (el.text || el.href || '').trim().slice(0, 40);
    const locator = locatorFromSelector(page, selectorDesc);

    await locator.waitFor({ state: 'visible', timeout: 15000 });
    await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
    await this.#delay();

    const isWrapper = (el.tagName === 'div' || el.tagName === 'span') && el.role === 'button';
    if (isWrapper) {
      try {
        console.log('[click] JS (wrapper card → link)');
        await clickViaEvaluate(page, selectorDesc, textHint);
        await new Promise((r) => setTimeout(r, CLICK_AFTER_DELAY_MS));
        return;
      } catch (_) {
        try {
          const innerLink = locator.locator('a[href]').first();
          await innerLink.waitFor({ state: 'visible', timeout: 3000 });
          console.log('[click] Playwright (inner link)');
          await innerLink.click({ timeout: 8000 });
          await new Promise((r) => setTimeout(r, CLICK_AFTER_DELAY_MS));
          return;
        } catch (_) {}
      }
    }

    try {
      console.log('[click] Playwright');
      await locator.click({ timeout: 10000 });
    } catch (err) {
      try {
        console.log('[click] Playwright force');
        await locator.click({ timeout: 5000, force: true });
      } catch (err2) {
        console.log('[click] JS fallback');
        await clickViaEvaluate(page, selectorDesc, textHint);
      }
    }
    await new Promise((r) => setTimeout(r, CLICK_AFTER_DELAY_MS));
  }

  /**
   * Type text into element by id, or into focused element if elementId omitted.
   * @param {{ url: string; title: string; elements: Array<{ id: number; selector: unknown }> }} snapshot
   * @param {number | null} elementId - null = type into focused element
   * @param {string} text
   */
  async typeText(snapshot, elementId, text) {
    const page = this.getPage();
    if (elementId != null) {
      const el = findElementInSnapshot(snapshot, elementId);
      const locator = locatorFromSelector(page, /** @type {{ type: string; value?: string; selector?: string; index?: number }} */ (el.selector));
      await locator.fill('');
      await locator.fill(text, { timeout: 5000 });
    } else {
      await page.keyboard.type(text, { delay: 50 });
    }
    await this.#delay();
  }

  /**
   * Select option in <select> by value or by visible label.
   * @param {{ elements: Array<{ id: number; selector: unknown }> }} snapshot
   * @param {number} elementId
   * @param {string} valueOrLabel - option value attribute or visible text
   */
  async selectOption(snapshot, elementId, valueOrLabel) {
    const el = findElementInSnapshot(snapshot, elementId);
    const page = this.getPage();
    const locator = locatorFromSelector(page, /** @type {{ type: string; value?: string; selector?: string; index?: number }} */ (el.selector));
    await locator.selectOption({ value: valueOrLabel }, { timeout: 5000 }).catch(() =>
      locator.selectOption({ label: valueOrLabel }, { timeout: 5000 })
    );
    await this.#delay();
  }

  /**
   * Set checkbox or radio checked state.
   * @param {{ elements: Array<{ id: number; selector: unknown }> }} snapshot
   * @param {number} elementId
   * @param {boolean} checked
   */
  async setCheckbox(snapshot, elementId, checked) {
    const el = findElementInSnapshot(snapshot, elementId);
    const page = this.getPage();
    const locator = locatorFromSelector(page, /** @type {{ type: string; value?: string; selector?: string; index?: number }} */ (el.selector));
    if (checked) await locator.check({ timeout: 5000 });
    else await locator.uncheck({ timeout: 5000 });
    await this.#delay();
  }

  /**
   * Scroll page.
   * @param {'up' | 'down' | 'left' | 'right'} direction
   */
  async scroll(direction) {
    const page = this.getPage();
    const delta = 300;
    if (direction === 'down') await page.mouse.wheel(0, delta);
    else if (direction === 'up') await page.mouse.wheel(0, -delta);
    else if (direction === 'left') await page.mouse.wheel(-delta, 0);
    else if (direction === 'right') await page.mouse.wheel(delta, 0);
    await this.#delay();
  }

  async #delay() {
    return new Promise((r) => setTimeout(r, ACTION_DELAY_MS));
  }

  async close() {
    if (this.#context) {
      await this.#context.close();
      this.#context = null;
      this.#page = null;
    }
  }
}
