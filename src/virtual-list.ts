import { buildRuleRow } from "./ui.js";
import { initCustomSelect, destroyCustomSelect } from "./select.js";

// ── Types ──
export interface RuleItem {
  type: string;
  target: string;
  source: string;
}

interface ScrollerItem {
  type: string;
  target: string;
  source: string;
  height: number;     // 动态测量出的实体真实物理高度
  measured: boolean;  // 标记是否已经真实测量过高度
}

/**
 * 从已渲染的行 DOM 中读取当前输入数据。
 */
function readRowValues(el: HTMLDivElement): RuleItem {
  const type = (el.querySelector(".rule-type") as HTMLSelectElement)?.value ?? "REDIRECT";
  const target = (el.querySelector(".rule-target") as HTMLInputElement)?.value ?? "";
  const source = (el.querySelector(".rule-source") as HTMLInputElement)?.value ?? "";
  return { type, target, source };
}

// ── Constants ──
/** 行与行之间的物理间距 (对应原 margin-bottom) */
const ROW_GAP = 8;
/** 默认预估高度 (测量就绪前兜底，单行 55px，双行 90px) */
const DEFAULT_HEIGHT_REDIRECT = 90;
const DEFAULT_HEIGHT_SINGLE = 55;
/** 视口上下额外渲染的行数，保障滚动流畅性 */
const OVERSCAN = 5;
/** 键盘弹出或聚焦时，底部动态垫高保障值 */
const KEYBOARD_PADDING = 320;

// ── VirtualScroller ──
export class VirtualScroller {
  private container: HTMLElement;
  private data: ScrollerItem[] = [];
  private rendered: Map<number, HTMLDivElement> = new Map();
  private spacer: HTMLDivElement;
  private rowsWrapper: HTMLDivElement;
  private scrollParent: HTMLElement | null = null;
  private rafId = 0;
  private destroyed = false;
  private yOffsets: number[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML = "";
    container.style.position = "relative";
    container.style.minHeight = "0";
    container.style.gap = "0";
    container.style.paddingBottom = "0";

    // 1. 绝对定位占位元素，在标准文档流内安全撑起父级的滚动高度
    this.spacer = document.createElement("div");
    this.spacer.style.cssText = "pointer-events:none;width:1px;";
    container.appendChild(this.spacer);

    // 2. 将行包裹层强制钉在左上角起跑线，彻底与 spacer 的流式高度排斥解耦，消除双重偏移漂移！
    this.rowsWrapper = document.createElement("div");
    this.rowsWrapper.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;";
    container.appendChild(this.rowsWrapper);

    this.scrollParent = this._findScrollParent(container);
    if (this.scrollParent) {
      this.scrollParent.addEventListener("scroll", this._onScroll, { passive: true });
    }
    window.addEventListener("resize", this._onScroll, { passive: true });

    // ── 初始化原生高性能 ResizeObserver ──
    this.resizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const targetEl = entry.target as HTMLDivElement;
        const idx = parseInt(targetEl.dataset.index ?? "", 10);
        if (!isNaN(idx) && idx >= 0 && idx < this.data.length) {
          const natural = targetEl.offsetHeight;
          if (natural > 0 && natural !== this.data[idx].height) {
            this.data[idx].height = natural;
            this.data[idx].measured = true;
            changed = true;
          }
        }
      }
      if (changed && !this.destroyed) {
        this._updateSpacer();
        // 毫秒级重置当前视口已渲染行的 top 定位，杜绝缝隙和重叠
        for (const [idx, el] of this.rendered) {
          el.style.top = `${this.yOffsets[idx]}px`;
        }
      }
    });

    // ── 绑定事件委托与焦点垫片逻辑 ──
    // 1. 规则项获得焦点：动态撑高底部
    this.rowsWrapper.addEventListener("focusin", () => {
      this._updateSpacer();
    });

    // 2. 规则项失去焦点：150ms 延迟过滤（防同一行内部两个 input 连续快速切换引起的高度重绘和闪烁）
    this.rowsWrapper.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!this.destroyed) {
          this._updateSpacer();
        }
      }, 150);
    });

    // 3. 删除按钮委托
    this.rowsWrapper.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".btn-del");
      if (!btn) return;
      const row = btn.closest(".rule-row") as HTMLDivElement;
      if (!row) return;
      const idx = parseInt(row.dataset.index ?? "", 10);
      if (!isNaN(idx)) {
        this.removeItem(idx);
      }
    });

    // 4. 规则类型选择改变事件冒泡委托
    this.rowsWrapper.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      if (!select.classList.contains("rule-type")) return;
      const row = select.closest(".rule-row") as HTMLDivElement;
      if (!row) return;
      const idx = parseInt(row.dataset.index ?? "", 10);
      if (!isNaN(idx) && idx >= 0 && idx < this.data.length) {
        const vals = readRowValues(row);
        this.data[idx].type = vals.type;
        this.data[idx].target = vals.target;
        this.data[idx].source = vals.source;
        // 切换后，先重置高度与测量状态，自适应触发新一轮的测高校正
        this.data[idx].height = vals.type === "REDIRECT" ? DEFAULT_HEIGHT_REDIRECT : DEFAULT_HEIGHT_SINGLE;
        this.data[idx].measured = false;

        this._updateSpacer();
        this._render();
      }
    });

    this._scheduleRender();
  }

  // ── 公共 API ──
  /** 批量设置数据（全量替换） */
  setItems(items: RuleItem[]): void {
    this._clearRendered();
    this.data = items.map((item) => ({
      type: item.type,
      target: item.target,
      source: item.source,
      height: item.type === "REDIRECT" ? DEFAULT_HEIGHT_REDIRECT : DEFAULT_HEIGHT_SINGLE,
      measured: false,
    }));
    this._updateSpacer();
    this._scheduleRender();
  }

  /** 追加一条规则 */
  addItem(item: RuleItem): void {
    this.data.push({
      type: item.type,
      target: item.target,
      source: item.source,
      height: item.type === "REDIRECT" ? DEFAULT_HEIGHT_REDIRECT : DEFAULT_HEIGHT_SINGLE,
      measured: false,
    });
    this._updateSpacer();
    this._scheduleRender();

    if (this.scrollParent) {
      const totalH = this.data.length > 0
        ? this.yOffsets[this.data.length - 1] + this.data[this.data.length - 1].height
        : 0;
      this.scrollParent.scrollTop = totalH;
    }
  }

  /** 移除指定索引的规则 */
  removeItem(index: number): void {
    if (index < 0 || index >= this.data.length) return;
    this.data.splice(index, 1);

    const el = this.rendered.get(index);
    if (el) {
      this._disposeRow(el, false); // 不做数据同步回写，防止越界干扰
      this.rendered.delete(index);
    }

    const newRendered = new Map<number, HTMLDivElement>();
    for (const [idx, rowEl] of this.rendered) {
      if (idx > index) {
        rowEl.dataset.index = String(idx - 1);
        newRendered.set(idx - 1, rowEl);
      } else {
        newRendered.set(idx, rowEl);
      }
    }
    this.rendered = newRendered;
    this._updateSpacer();
    this._scheduleRender();
  }

  /**
   * 获取所有规则的当前值（含用户在已渲染行中的编辑）。
   */
  getCurrentData(): RuleItem[] {
    for (const [idx, el] of this.rendered) {
      if (el.isConnected) {
        const vals = readRowValues(el);
        this.data[idx].type = vals.type;
        this.data[idx].target = vals.target;
        this.data[idx].source = vals.source;
      }
    }
    return this.data.map((d) => ({
      type: d.type,
      target: d.target,
      source: d.source,
    }));
  }

  /** 销毁 */
  destroy(): void {
    this.destroyed = true;
    if (this.scrollParent) {
      this.scrollParent.removeEventListener("scroll", this._onScroll);
    }
    window.removeEventListener("resize", this._onScroll);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._clearRendered();
    this.spacer.remove();
    this.rowsWrapper.remove();
  }

  // ── 私有方法 ──
  private _onScroll = (): void => {
    this._scheduleRender();
  };

  private _scheduleRender(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.destroyed) this._render();
    });
  }

  private _findScrollParent(el: HTMLElement): HTMLElement | null {
    // 先检查元素自身是否可滚动
    if (this._isScrollable(el)) return el;
    // 再逐级检查父级
    let parent = el.parentElement;
    while (parent) {
      if (this._isScrollable(parent)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  /** 判断元素是否可滚动(计算样式 + CSS 类名双重检测) */
  private _isScrollable(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    const ov = style.overflow + style.overflowY;
    if (ov.includes("auto") || ov.includes("scroll")) return true;
    // body:not(.loaded) 时 overflow-y-auto 被 !important 覆盖为 hidden,
    // 但类名仍存在,作为回退检测
    if (el.classList.contains("overflow-y-auto") || el.classList.contains("list-scrollable")) return true;
    return false;
  }

  /** 递归计算静态顶距，避免 offsetTop 的上下文定位错位 */
  private _getContainerOffsetTop(): number {
    let top = 0;
    let el: HTMLElement | null = this.container;
    const stopAt = this.scrollParent;
    while (el && el !== stopAt) {
      top += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    return top;
  }

  private _recalcPositions(): void {
    this.yOffsets = [];
    let currentY = 0;
    for (let i = 0; i < this.data.length; i++) {
      this.yOffsets.push(currentY);
      currentY += this.data[i].height + ROW_GAP; // 累加：实体真实高度 + 物理行间距
    }
  }

  private _updateSpacer(): void {
    this._recalcPositions();
    let h = this.data.length > 0
      ? this.yOffsets[this.data.length - 1] + this.data[this.data.length - 1].height
      : 0;

    // 核心垫片处理：如果检测到当前有输入框获得焦点，自动注入高垫片高度以备软件盘腾出滚动空间
    const hasActiveInput = this.rowsWrapper.contains(document.activeElement);
    if (hasActiveInput) {
      h += KEYBOARD_PADDING;
    }

    this.spacer.style.height = `${h}px`;
  }

  private _clearRendered(): void {
    for (const [, el] of this.rendered) {
      this._disposeRow(el, true);
    }
    this.rendered.clear();
  }

  private _disposeRow(el: HTMLDivElement, syncData = true): void {
    if (syncData) {
      const idx = parseInt(el.dataset.index ?? "", 10);
      if (!isNaN(idx) && idx >= 0 && idx < this.data.length) {
        const vals = readRowValues(el);
        this.data[idx].type = vals.type;
        this.data[idx].target = vals.target;
        this.data[idx].source = vals.source;
      }
    }
    // 解绑行的高度变更监听
    this.resizeObserver?.unobserve(el);
    const select = el.querySelector(".rule-type") as HTMLSelectElement | null;
    if (select) {
      destroyCustomSelect(select);
    }
    el.remove();
  }

  private _render(): void {
    if (!this.scrollParent) return;
    const total = this.data.length;
    if (total === 0) {
      this._clearRendered();
      return;
    }

    // 黄金计算公式：计算出被容器滚出视口的纯像素值
    const containerTop = this._getContainerOffsetTop();
    const hiddenAbove = Math.max(0, this.scrollParent.scrollTop - containerTop);
    const viewportHeight = this.scrollParent.clientHeight;

    // 二分法精确检索当前可视区的起始行索引
    let startIdx = 0;
    let lo = 0, hi = this.yOffsets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.yOffsets[mid] <= hiddenAbove) {
        startIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    startIdx = Math.max(0, startIdx - OVERSCAN);

    // 检索末尾行索引位置
    let endIdx = startIdx;
    while (endIdx < this.data.length && this.yOffsets[endIdx] < (hiddenAbove + viewportHeight)) {
      endIdx++;
    }
    endIdx = Math.min(this.data.length, endIdx + OVERSCAN);

    // 移出边界以外的行，断开监听并彻底释放 dropdown 节点
    const toRemove: number[] = [];
    for (const [idx] of this.rendered) {
      if (idx < startIdx || idx >= endIdx) toRemove.push(idx);
    }
    for (const idx of toRemove) {
      const el = this.rendered.get(idx)!;
      this._disposeRow(el, true);
      this.rendered.delete(idx);
    }

    // 装载和重置当前视口内的行 DOM
    for (let i = startIdx; i < endIdx; i++) {
      const item = this.data[i];
      const existEl = this.rendered.get(i);
      if (existEl) {
        existEl.style.top = `${this.yOffsets[i]}px`;
        continue;
      }

      const el = buildRuleRow(item.type, item.target, item.source);
      el.dataset.index = String(i);
      el.style.position = "absolute";
      el.style.top = `${this.yOffsets[i]}px`;
      el.style.left = "0";
      el.style.right = "0";
      el.style.margin = "0"; // 移除 margin 由 yOffsets 物理距离接管
      el.style.width = "100%";

      this.rowsWrapper.appendChild(el);
      this.rendered.set(i, el);

      // 实时监听行高度变化
      this.resizeObserver?.observe(el);

      requestAnimationFrame(() => {
        if (!this.destroyed && el.isConnected) {
          const select = el.querySelector(".rule-type") as HTMLSelectElement | null;
          if (select) initCustomSelect(select);
        }
      });
    }
  }
}