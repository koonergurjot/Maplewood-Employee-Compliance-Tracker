import rawFeatherIcons from 'feather-icons/dist/icons.json';

const FEATHER_INIT_ATTR = 'data-feather-initialized';
const FEATHER_PROCESSED_ATTR = 'data-feather-processed';
const DEFAULT_SVG_ATTRIBUTES = Object.freeze({
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});
const FEATHER_ICONS = createIconRegistry();

function createIconRegistry() {
  const registry = new Map();
  if (!rawFeatherIcons || typeof rawFeatherIcons !== 'object') {
    return registry;
  }

  Object.entries(rawFeatherIcons).forEach(([name, svgContent]) => {
    if (typeof svgContent !== 'string' || !svgContent.trim()) {
      return;
    }

    registry.set(name, {
      toSvg(options = {}) {
        const normalizedAttrs = normalizeAttributes(options);
        const classAttr = normalizedAttrs.class;
        delete normalizedAttrs.class;

        const attributes = { ...DEFAULT_SVG_ATTRIBUTES, ...normalizedAttrs };
        const classNames = new Set([`feather`, `feather-${name}`]);

        if (typeof classAttr === 'string' && classAttr.trim()) {
          classAttr
            .split(/\s+/)
            .filter(Boolean)
            .forEach(value => classNames.add(value));
        }

        attributes.class = Array.from(classNames).join(' ');

        return `<svg ${serializeAttributes(attributes)}>${svgContent}</svg>`;
      },
    });
  });

  return registry;
}

function normalizeAttributes(attributes) {
  return Object.entries(attributes || {}).reduce((acc, [rawName, rawValue]) => {
    if (rawValue === undefined || rawValue === null || rawValue === false) {
      return acc;
    }

    const name = normalizeAttributeName(rawName);
    if (!name) {
      return acc;
    }

    const value = typeof rawValue === 'boolean' ? String(rawValue) : rawValue;
    acc[name] = value;
    return acc;
  }, {});
}

function normalizeAttributeName(name) {
  if (!name) {
    return '';
  }

  if (name === 'className') {
    return 'class';
  }

  if (name === 'strokeWidth') {
    return 'stroke-width';
  }

  if (name === 'strokeLinecap') {
    return 'stroke-linecap';
  }

  if (name === 'strokeLinejoin') {
    return 'stroke-linejoin';
  }

  return name.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeAttributeValue(value)}"`)
    .join(' ');
}

function escapeAttributeValue(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getElementAttributes(element) {
  return Array.from(element.attributes ?? []).reduce((attrs, attr) => {
    attrs[attr.name] = attr.value;
    return attrs;
  }, {});
}

function markProcessed(element, status) {
  if (!element) {
    return;
  }

  try {
    element.setAttribute(FEATHER_PROCESSED_ATTR, status);
  } catch (error) {
    // Non-fatal: some elements (e.g., in older browsers) may not support custom attributes.
  }

  if (element?.dataset) {
    try {
      element.dataset.featherProcessed = status;
    } catch (error) {
      // Ignore dataset assignment failures silently.
    }
  }
}

function clearProcessed(element) {
  if (!element) {
    return;
  }

  const hadFallbackStatus = element.getAttribute?.('data-feather-status') === 'fallback';
  const previousFailedName = element.getAttribute?.('data-feather-failed-name');

  try {
    element.removeAttribute('data-feather-status');
  } catch (error) {
    // Ignore removal issues.
  }

  try {
    element.removeAttribute('data-feather-failed-name');
  } catch (error) {
    // Ignore removal issues.
  }

  try {
    element.removeAttribute(FEATHER_PROCESSED_ATTR);
  } catch (error) {
    // Ignore removal issues.
  }

  if (hadFallbackStatus && element?.textContent === '❔') {
    try {
      element.textContent = '';
    } catch (error) {
      // Ignore text reset issues.
    }
  }

  if (hadFallbackStatus && element?.getAttribute?.('role') === 'img') {
    try {
      element.removeAttribute('role');
    } catch (error) {
      // Ignore role removal issues.
    }
  }

  if (hadFallbackStatus) {
    try {
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel === 'Icon' || (previousFailedName && ariaLabel === `${previousFailedName} icon`)) {
        element.removeAttribute('aria-label');
      }
    } catch (error) {
      // Ignore aria label removal issues.
    }
  }

  if (element?.dataset) {
    try {
      delete element.dataset.featherProcessed;
    } catch (error) {
      // Ignore dataset removal issues.
    }
  }
}

function applyFallback(element, iconName, error) {
  if (!element) {
    return;
  }

  const resolvedName = iconName || element.getAttribute?.('data-feather') || 'unknown';
  if (error) {
    console.warn(`Failed to render feather icon "${resolvedName}"`, error);
  } else {
    console.warn(`Feather icon "${resolvedName}" unavailable or invalid.`);
  }

  try {
    element.setAttribute('data-feather-status', 'fallback');
    element.setAttribute('data-feather-failed-name', resolvedName);
    if (!element.getAttribute('role')) {
      element.setAttribute('role', 'img');
    }
    if (!element.getAttribute('aria-label')) {
      const label = resolvedName === 'unknown' ? 'Icon' : `${resolvedName} icon`;
      element.setAttribute('aria-label', label);
    }
    if (!element.textContent?.trim()) {
      element.textContent = '❔';
    }
  } catch (fallbackError) {
    console.warn('Failed to apply feather icon fallback state.', fallbackError);
  }

  markProcessed(element, 'failed');
}

function createSvgElement(svgString) {
  if (typeof document === 'undefined') {
    return null;
  }

  const template = document.createElement('template');
  template.innerHTML = (svgString || '').trim();
  return template.content.firstElementChild;
}

export function safeFeatherReplace(root) {
  if (typeof document === 'undefined') {
    return;
  }

  if (!FEATHER_ICONS.size) {
    console.warn('Feather icon data not available');
    return;
  }

  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  const selector = `[data-feather]:not([${FEATHER_INIT_ATTR}])`;
  const elements = Array.from(scope.querySelectorAll(selector));

  if (scope !== document && typeof scope.matches === 'function' && scope.matches(selector)) {
    elements.unshift(scope);
  }

  elements.forEach(element => {
    if (element?.dataset?.featherInitialized === 'true') {
      return;
    }

    const parent = element?.parentNode;
    if (!parent) {
      return;
    }

    const processedState = element.getAttribute(FEATHER_PROCESSED_ATTR) || element.dataset?.featherProcessed;
    if (processedState === 'failed') {
      const previousName = element.getAttribute('data-feather-failed-name');
      const currentName = element.getAttribute('data-feather');
      if (previousName && currentName && previousName !== currentName) {
        clearProcessed(element);
      } else {
        return;
      }
    }

    let iconName = '';

    try {
      const elementAttrs = getElementAttributes(element);
      iconName = elementAttrs['data-feather'] || '';
      if (!iconName) {
        return;
      }

      const icon = FEATHER_ICONS.get(iconName);
      if (!icon) {
        applyFallback(element, iconName);
        return;
      }

      const sanitizedAttrs = { ...elementAttrs };
      delete sanitizedAttrs['data-feather'];

      const svgString = icon.toSvg(sanitizedAttrs);
      const svgElement = createSvgElement(svgString);
      const isSvgElement = typeof SVGElement !== 'undefined' && svgElement instanceof SVGElement;
      if (!isSvgElement) {
        applyFallback(element, iconName);
        return;
      }

      svgElement.setAttribute('data-feather', iconName);
      svgElement.setAttribute(FEATHER_INIT_ATTR, 'true');

      if (svgElement.dataset) {
        svgElement.dataset.featherInitialized = 'true';
      }

      markProcessed(svgElement, 'success');

      try {
        parent.replaceChild(svgElement, element);
      } catch (replaceError) {
        applyFallback(element, iconName, replaceError);
        return;
      }
    } catch (error) {
      applyFallback(element, iconName, error);
    }
  });
}
