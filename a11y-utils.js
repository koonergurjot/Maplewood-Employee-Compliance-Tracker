const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

function isVisible(element){
  if(!element) return false;
  const style = window.getComputedStyle(element);
  return style && style.visibility !== 'hidden' && style.display !== 'none';
}

export function getFocusableElements(container){
  if(!container || typeof container.querySelectorAll !== 'function'){
    return [];
  }
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => {
    if(el.hasAttribute('disabled')) return false;
    if(el.getAttribute('aria-hidden') === 'true') return false;
    return isVisible(el);
  });
}

export function trapFocusWithin(container){
  if(!container) return () => {};

  const hadTabIndex = container.hasAttribute('tabindex');
  if(!hadTabIndex){
    container.setAttribute('tabindex', '-1');
  }

  const getElements = () => getFocusableElements(container);

  const focusFirst = () => {
    const [first] = getElements();
    const target = first || container;
    if(target && typeof target.focus === 'function'){
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    }
  };

  const handleKeydown = (event) => {
    if(event.key !== 'Tab') return;
    const elements = getElements();
    if(!elements.length){
      event.preventDefault();
      focusFirst();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement;
    if(event.shiftKey){
      if(active === first || !container.contains(active)){
        event.preventDefault();
        try {
          last.focus({ preventScroll: true });
        } catch (error) {
          last.focus();
        }
      }
    } else {
      if(active === last){
        event.preventDefault();
        try {
          first.focus({ preventScroll: true });
        } catch (error) {
          first.focus();
        }
      }
    }
  };

  const maintainFocus = (event) => {
    if(container.contains(event.target)){
      return;
    }
    const elements = getElements();
    const target = elements[0] || container;
    if(!target || typeof target.focus !== 'function'){
      return;
    }
    event.preventDefault?.();
    requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    });
  };

  container.addEventListener('keydown', handleKeydown);
  document.addEventListener('focusin', maintainFocus);

  return () => {
    container.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('focusin', maintainFocus);
    if(!hadTabIndex){
      container.removeAttribute('tabindex');
    }
  };
}
