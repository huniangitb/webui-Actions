/**
 * CustomSelect — replaces native <select> with a styled button + dropdown.
 * Dropdown is appended to document.body to avoid overflow clipping.
 * Keeps the native select hidden and syncs value bidirectionally.
 */

interface CustomSelectOption {
  value: string;
  label: string;
}

const OPEN_CLASS = "open";
let activeDropdown: HTMLElement | null = null;
let activeTrigger: HTMLElement | null = null;

function closeActiveDropdown(): void {
  if (activeDropdown) {
    activeDropdown.classList.remove(OPEN_CLASS);
    activeDropdown.style.display = "none";
    activeDropdown = null;
    activeTrigger = null;
  }
}

document.addEventListener("click", (e: MouseEvent) => {
  if (!activeDropdown) return;
  const target = e.target as HTMLElement;
  if (!target.closest(".mx-custom-select") && !target.closest(".mx-select-dropdown")) {
    closeActiveDropdown();
  }
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && activeDropdown) {
    closeActiveDropdown();
    activeTrigger?.focus();
  }
});

/* Position dropdown relative to trigger, appended to body */
function positionDropdown(trigger: HTMLElement, dropdown: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const maxH = Math.min(240, Math.max(spaceBelow, spaceAbove) - 4);
  dropdown.style.maxHeight = `${maxH}px`;
  dropdown.style.width = `${rect.width}px`;
  dropdown.style.left = `${rect.left}px`;

  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    dropdown.style.top = "";
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.bottom = "";
  }
}

export function initCustomSelect(nativeSelect: HTMLSelectElement, _options?: CustomSelectOption[]): void {
  if (nativeSelect.dataset.customSelect === "initialized") return;
  nativeSelect.dataset.customSelect = "initialized";

  const getOptions = (): CustomSelectOption[] =>
    Array.from(nativeSelect.options).map((opt) => ({
      value: opt.value,
      label: opt.label,
    }));

  /* Create wrapper (replaces native select visually) */
  const wrapper = document.createElement("div");
  wrapper.className = "mx-custom-select";

  /* Create trigger button */
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mx-select-trigger";
  trigger.innerHTML = `
    <span class="mx-select-trigger-label">${nativeSelect.options[nativeSelect.selectedIndex]?.label || ""}</span>
    <span class="mx-select-arrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
    </span>
  `;

  /* Match trigger width to original select width */
  if (nativeSelect.style.width) {
    wrapper.style.width = nativeSelect.style.width;
  }

  /* Create dropdown (appended to body) */
  const dropdown = document.createElement("div");
  dropdown.className = "mx-select-dropdown";
  dropdown.style.position = "fixed";
  dropdown.style.display = "none";

  function renderOptions(): void {
    const currentVal = nativeSelect.value;
    dropdown.innerHTML = getOptions()
      .map(
        (opt) =>
          `<button type="button" class="mx-select-option${opt.value === currentVal ? " active" : ""}" data-value="${opt.value}">${opt.label}</button>`,
      )
      .join("");
  }
  renderOptions();

  /* Option click */
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

  /* Toggle */
  trigger.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    if (dropdown.classList.contains(OPEN_CLASS)) {
      closeActiveDropdown();
      return;
    }
    closeActiveDropdown();
    renderOptions();
    dropdown.style.display = "block";
    positionDropdown(trigger, dropdown);
    /* Force reflow then add class for animation */
    dropdown.getBoundingClientRect();
    dropdown.classList.add(OPEN_CLASS);
    activeDropdown = dropdown;
    activeTrigger = trigger;
  });

  /* Reposition on scroll / resize while open */
  const reposition = (): void => {
    if (dropdown.classList.contains(OPEN_CLASS)) {
      positionDropdown(trigger, dropdown);
    }
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  /* Sync label on programmatic change */
  nativeSelect.addEventListener("change", () => {
    const label = nativeSelect.options[nativeSelect.selectedIndex]?.label ?? "";
    trigger.querySelector(".mx-select-trigger-label")!.textContent = label;
  });

  /* Replace native with wrapper in DOM */
  nativeSelect.parentNode?.insertBefore(wrapper, nativeSelect);
  wrapper.appendChild(trigger);

  /* Hide native select */
  nativeSelect.style.cssText =
    "position:absolute !important;width:1px !important;height:1px !important;padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0,0,0,0) !important;white-space:nowrap !important;border:0 !important;";
  wrapper.appendChild(nativeSelect);

  /* Append dropdown to body so it's never clipped */
  document.body.appendChild(dropdown);
}

export function initAllCustomSelects(container: HTMLElement | Document = document): void {
  container.querySelectorAll<HTMLSelectElement>("select.mx-select").forEach((el) => initCustomSelect(el));
}
