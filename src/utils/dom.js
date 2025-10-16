export function qs(root, sel) {
  return (root || document).querySelector(sel);
}
export function qsAll(root, sel) {
  return Array.from((root || document).querySelectorAll(sel));
}
