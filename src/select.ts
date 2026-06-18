/**
 * CustomSelect — replaces native <select> with a styled button + dropdown
 * Keeps the native select hidden and syncs value bidirectionally so existing
 * code that reads element.value continues to work unchanged.
 */

interface CustomSelectOption {
  value: string;
  label: string;
}

const OPEN_CLASS = "open";
let activeDropdown: HTMLElement | null = null;

/* Close any currently open dropdown when another one opens */
function closeActiveDropdown(): void {
  if (activeDropdown) {
    activeDropdown.classList.remove(OPEN_CLASS);
    activeDropdown = null;
  }
}

/* Close on outside click */
document.addEventListener("click", (e: MouseEvent) => {
  if (!activeDropdown) return;
  const target = e.target as HTMLElement;
  if (!target.closest(".mx-custom-select")) {
    closeActiveDropdown();
  }
});

/* Close on Escape */
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && activeDropdown) {
    closeActiveDropdown();
    (activeDropdown as unknown as { _trigger?: HTMLElement })._trigger?.focus();
  }
});

export function initCustomSelect(nativeSelect: HTMLSelectElement): void {
  if (nativeSelect.dataset.customSelect === "initialized") return;
  nativeSelect.dataset.customSelect = "initialized";

  /* Build option array */
  const getOptions = (): CustomSelectOption[] =>
    Array.from(nativeSelect.options).map((opt) => ({
      value: opt.value,
      label: opt.label,
    }));

  /* Create wrapper */
  const wrapper = document.createElement("div");
  wrapper.className = "mx-custom-select";
  wrapper.style.cssText = `
    position: relative; display: inline-flex; width: ${nativeSelect.style.width || "auto"};
  `;

  /* Create trigger button */
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mx-select-trigger";
  trigger.innerHTML = `
    <span class="mx-select-trigger-label">${nativeSelect.options[nativeSelect.selectedIndex]?.label || ""}</span>
    <span class="mx-select-arrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </span>
  `;

  /* Create dropdown */
  const dropdown = document.createElement("div");
  dropdown.className = "mx-select-dropdown";

  function renderOptions(): void {
    dropdown.innerHTML = getOptions()
      .map(
        (opt) =>
          `<button type="button" class="mx-select-option${opt.value === nativeSelect.value ? " active" : ""}" data-value="${opt.value}">${opt.label}</button>`,
      )
      .join("");
  }
  renderOptions();

  /* Handle option click */
  dropdown.addEventListener("click", (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".mx-select-option");
    if (!btn) return;
    const value = btn.dataset.value ?? "";
    nativeSelect.value = value;
    trigger.querySelector(".mx-select-trigger-label")!.textContent = btn.textContent;
    dropdown.querySelectorAll(".mx-select-option").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    closeActiveDropdown();
    nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  /* Toggle dropdown on trigger click */
  trigger.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    if (dropdown.classList.contains(OPEN_CLASS)) {
      closeActiveDropdown();
    } else {
      closeActiveDropdown();
      renderOptions(); /* re-render in case options changed dynamically */
      dropdown.classList.add(OPEN_CLASS);
      activeDropdown = dropdown;

      /* Store reference for Escape key */
      (dropdown as unknown as { _trigger: HTMLElement })._trigger = trigger;

      /* Position: open upward if insufficient space below */
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      dropdown.style.maxHeight = `${Math.min(240, Math.max(spaceBelow, spaceAbove) - 4)}px`;
      dropdown.style.top = "";
      dropdown.style.bottom = "";
      if (spaceBelow < 160 && spaceAbove > spaceBelow) {
        dropdown.style.bottom = "100%";
        dropdown.style.marginBottom = "4px";
      } else {
        dropdown.style.top = "100%";
        dropdown.style.marginTop = "4px";
      }
    }
  });

  /* Sync label when native select changes programmatically */
  nativeSelect.addEventListener("change", () => {
    const label = nativeSelect.options[nativeSelect.selectedIndex]?.label ?? "";
    trigger.querySelector(".mx-select-trigger-label")!.textContent = label;
  });

  /* Insert wrapper before native select, move native inside */
  nativeSelect.parentNode?.insertBefore(wrapper, nativeSelect);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  /* Hide native select visually but keep it in DOM for form value access */
  nativeSelect.style.cssText =
    "position:absolute !important;width:1px !important;height:1px !important;padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0,0,0,0) !important;white-space:nowrap !important;border:0 !important;";
  wrapper.appendChild(nativeSelect);
}

export function initAllCustomSelects(container: HTMLElement | Document = document): void {
  container.querySelectorAll<HTMLSelectElement>("select.mx-select").forEach(initCustomSelect);
}
