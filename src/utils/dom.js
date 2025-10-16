export function qs(root, sel) {
  return (root || document).querySelector(sel);
}

export function toArray(maybeList) {
  if (!maybeList) {
    return [];
  }

  if (Array.isArray(maybeList)) {
    return maybeList;
  }

  try {
    return Array.from(maybeList);
  } catch {
    return [maybeList];
  }
}

export function qsAll(root, sel) {
  return toArray((root || document).querySelectorAll(sel));
}
