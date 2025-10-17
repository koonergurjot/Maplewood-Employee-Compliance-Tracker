const hasWindow = typeof window !== 'undefined';
const hasDocument = typeof document !== 'undefined';

if (!hasWindow || !hasDocument) {
  // Debug hitbox tooling is only relevant in the browser.
  return;
}

const body = document.body;
const blockerAttribute = 'data-hitbox-blocker';
let raf = null;
let enabled = false;

const clearBlockers = () => {
  const active = body.querySelectorAll(`[${blockerAttribute}]`);
  active.forEach((el) => {
    el.removeAttribute(blockerAttribute);
  });
};

const annotateBlockers = () => {
  clearBlockers();
  if (!enabled) return;

  const viewportArea = window.innerWidth * window.innerHeight;
  if (!viewportArea) return;

  const elements = body.querySelectorAll('*');
  elements.forEach((el) => {
    if (!(el instanceof HTMLElement) || el === body) return;

    const style = window.getComputedStyle(el);
    if (
      style.pointerEvents === 'none' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const area = rect.width * rect.height;
    if (area < viewportArea * 0.6) return;
    if (rect.width < window.innerWidth * 0.6 || rect.height < window.innerHeight * 0.6) return;

    const coverage = Math.min(100, Math.round((area / viewportArea) * 100));
    el.setAttribute(blockerAttribute, `${coverage}%`);
  });
};

const scheduleAnnotate = () => {
  if (!enabled) return;
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = null;
    annotateBlockers();
  });
};

const dispatchToggleEvent = () => {
  const event = new CustomEvent('debug-hitboxes:toggled', {
    detail: { enabled }
  });
  document.dispatchEvent(event);
};

const toggle = (force) => {
  const next = typeof force === 'boolean' ? force : !body.classList.contains('debug-hitboxes');
  enabled = next;
  body.classList.toggle('debug-hitboxes', enabled);
  if (!enabled) {
    clearBlockers();
  } else {
    annotateBlockers();
  }
  dispatchToggleEvent();
  return enabled;
};

const observer = new MutationObserver(() => scheduleAnnotate());
observer.observe(body, {
  attributes: true,
  attributeFilter: ['style', 'class'],
  childList: true,
  subtree: true
});

window.__debugHitboxes = {
  toggle,
  isEnabled: () => enabled,
  refresh: () => annotateBlockers()
};

window.addEventListener(
  'keydown',
  (event) => {
    if (event.key.toLowerCase() === 'h' && event.altKey && event.shiftKey) {
      event.preventDefault();
      toggle();
    }
  },
  { passive: false }
);

window.addEventListener('resize', scheduleAnnotate, true);
window.addEventListener('scroll', scheduleAnnotate, true);

dispatchToggleEvent();
