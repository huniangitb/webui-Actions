/**
 * Miuix Ripple — click ripple effect
 * Ported from miuix-console/utils/ripple.js
 * Enabled via data-ripple attribute
 */
export function initRipple(): void {
  document.addEventListener("pointerdown", (e: PointerEvent) => {
    const el = (e.target as Element).closest("[data-ripple]") as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const r = document.createElement("span");
    const size = Math.max(rect.width, rect.height) * 2;
    r.style.cssText = `
      position:absolute;border-radius:50%;
      background:currentColor;opacity:0.08;
      width:${size}px;height:${size}px;
      left:${e.clientX - rect.left - size / 2}px;
      top:${e.clientY - rect.top - size / 2}px;
      transform:scale(0);animation:mx-ripple 0.6s ease-out;
      pointer-events:none;
    `;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.overflow = "hidden";
    el.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });
}
