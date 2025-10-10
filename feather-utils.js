import feather from 'feather-icons';

const FEATHER_INIT_ATTR = 'data-feather-initialized';

function getElementAttributes(element) {
  return Array.from(element.attributes ?? []).reduce((attrs, attr) => {
    attrs[attr.name] = attr.value;
    return attrs;
  }, {});
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

  if (typeof feather === 'undefined' || !feather || typeof feather.icons !== 'object') {
    console.warn('Feather icons library not available');
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
    if (!parent) return;

    const elementAttrs = getElementAttributes(element);
    const iconName = elementAttrs['data-feather'];
    if (!iconName) return;

    const icon = feather.icons[iconName];
    if (!icon) {
      console.warn(`Feather icon "${iconName}" not found`);
      return;
    }

    delete elementAttrs['data-feather'];

    let svgElement = null;
    try {
      const svgString = icon.toSvg(elementAttrs);
      svgElement = createSvgElement(svgString);
    } catch (error) {
      console.warn(`Failed to render feather icon "${iconName}"`, error);
      return;
    }

    const isSvgElement = typeof SVGElement !== 'undefined'
      ? svgElement instanceof SVGElement
      : svgElement?.nodeName?.toLowerCase() === 'svg';

    if (!isSvgElement) {
      console.warn(`Feather icon "${iconName}" did not produce a valid SVG element`);
      return;
    }

    svgElement.setAttribute('data-feather', iconName);
    svgElement.setAttribute(FEATHER_INIT_ATTR, 'true');

    if (svgElement.dataset) {
      svgElement.dataset.featherInitialized = 'true';
    }

    parent.replaceChild(svgElement, element);
  });
}
