const warned = new Set();

export function warnOnce(name, message) {
  const keySource = typeof name === 'string' && name.trim() ? name.trim() : '';
  const fallback = typeof message === 'string' && message.trim() ? message.trim() : '';
  const key = keySource || fallback;

  if (!key) {
    return;
  }

  if (warned.has(key)) {
    return;
  }

  warned.add(key);

  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(fallback || key);
  }
}

