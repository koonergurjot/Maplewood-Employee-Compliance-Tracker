import feather from 'feather-icons';

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
  const elements = scope.querySelectorAll('[data-feather]');

  elements.forEach(element => {
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

    parent.replaceChild(svgElement, element);
  });
}
