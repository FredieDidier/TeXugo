// Icon-only buttons (activity bar, PDF bar) explain themselves in a hover
// tooltip, which a keyboard user never sees. When one of them gets keyboard
// focus, show its title in a small label beside it.
const SEL = '.activitybar .icon-btn, .pdf-tools .icon-btn, .pdf-tools .btn';

export function installFocusTips(doc = document) {
  const tip = doc.createElement('div');
  tip.className = 'focus-tip';
  tip.setAttribute('aria-hidden', 'true'); // the button's own name is read
  const hide = () => tip.remove();
  doc.addEventListener('focusin', (e) => {
    const el = e.target.closest?.(SEL);
    let keyboard = false;
    try {
      keyboard = !!el && el.matches(':focus-visible');
    } catch {}
    const text = el && (el.getAttribute('title') || el.getAttribute('aria-label'));
    if (!keyboard || !text) return hide();
    tip.textContent = text;
    doc.body.append(tip);
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const side = el.closest('.activitybar');
    let x = side ? r.right + 8 : r.left + r.width / 2 - t.width / 2;
    let y = side ? r.top + r.height / 2 - t.height / 2 : r.bottom + 6;
    x = Math.max(4, Math.min(x, innerWidth - t.width - 4));
    y = Math.max(4, Math.min(y, innerHeight - t.height - 4));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  doc.addEventListener('focusout', hide);
  doc.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  window.addEventListener('blur', hide);
}
