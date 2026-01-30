/**
 * Security layer: detects destructive actions (pay, delete, etc.) and requires user confirmation.
 */

/** @type {RegExp[]} Keywords that indicate a destructive or sensitive action (button/link text). */
const DESTRUCTIVE_PATTERNS = [
  /\b(pay|оплат|купи|buy)\b/i,
  /\b(checkout|оформл|place\s*order|подтвержд.*заказ)\b/i,
  /\b(confirm\s*order|подтвердить)\b/i,
  /\b(delete|удал|remove|удалить)\b/i,
  /\b(unsubscribe|отпис)\b/i,
  /\b(cancel\s*subscription|отменить\s*подписк)\b/i,
  /\b(send\s*money|перевод|transfer)\b/i,
  /\b(submit\s*payment|оплатить)\b/i,
];

/**
 * Check if a tool call is destructive and should require user confirmation.
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {{ elements: Array<{ id: number; text?: string; value?: string; ariaLabel?: string }> }} snapshot
 * @returns {{ destructive: boolean; description?: string }}
 */
export function checkDestructiveAction(toolName, args, snapshot) {
  if (toolName !== 'click_element') {
    return { destructive: false };
  }

  const elementId = args.element_id;
  if (typeof elementId !== 'number') return { destructive: false };

  const el = snapshot.elements?.find((e) => e.id === elementId);
  if (!el) return { destructive: false };

  const text = [
    el.text,
    el.value,
    el.title,
    el.labelText,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(' ');

  if (!text) return { destructive: false };

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(text)) {
      const description = (el.text || el.value || 'Action').toString().slice(0, 80);
      return { destructive: true, description: description.trim() || 'Sensitive action' };
    }
  }

  return { destructive: false };
}
