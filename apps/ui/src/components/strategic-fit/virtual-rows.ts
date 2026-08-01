/**
 * Task 12.3 — the reactive half of list virtualization.
 *
 * `virtualWindow` in `visualization-limits.ts` owns the deterministic geometry; this primitive only
 * measures one scroll container and feeds it. Virtualization is deliberately opt-out: print and
 * export modes mount the complete list because a printed page has no viewport to scroll, and a list
 * that already fits under the mount cap never pays for spacers.
 */
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { virtualWindow, type VirtualWindow } from "./visualization-limits";

/**
 * Row height of a virtualized table row, in pixels. Geometry must match what the browser lays out,
 * so `.strategic-fit-virtual-scroll tbody tr` fixes exactly this height in `styles.css`.
 */
export const VIRTUAL_TABLE_ROW_HEIGHT = 36;

/** Column width of a virtualized grid column, matching `.strategic-fit-virtual-scroll` columns. */
export const VIRTUAL_TABLE_COLUMN_WIDTH = 132;

export interface VirtualRowsOptions<T> {
  readonly items: Accessor<readonly T[]>;
  /** Nominal row size in the scrolling axis, in pixels. */
  readonly rowSize: number;
  /** When false the complete list is mounted; used for print/export and for small lists. */
  readonly enabled?: Accessor<boolean>;
  readonly maximumMounted?: number;
  readonly axis?: "vertical" | "horizontal";
}

export interface VirtualRows<T> {
  readonly window: Accessor<VirtualWindow<T>>;
  /** `ref` for the scrolling container; it observes size and scroll for as long as it is mounted. */
  readonly attach: (element: HTMLElement) => void;
  /** Scroll the container so the given logical index is inside the viewport. */
  readonly scrollToIndex: (index: number) => void;
}

function completeWindow<T>(items: readonly T[]): VirtualWindow<T> {
  return {
    items,
    start: 0,
    mounted: items.length,
    total: items.length,
    lead: 0,
    trail: 0,
    complete: true,
  };
}

export function createVirtualRows<T>(options: VirtualRowsOptions<T>): VirtualRows<T> {
  const horizontal = options.axis === "horizontal";
  const [viewportSize, setViewportSize] = createSignal(0);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  let container: HTMLElement | null = null;

  const measure = (element: HTMLElement) => {
    setViewportSize(horizontal ? element.clientWidth : element.clientHeight);
    setScrollOffset(horizontal ? element.scrollLeft : element.scrollTop);
  };

  const attach = (element: HTMLElement) => {
    container = element;
    measure(element);
    const onScroll = () => setScrollOffset(horizontal ? element.scrollLeft : element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            measure(element);
          });
    observer?.observe(element);
    onCleanup(() => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (container === element) container = null;
    });
  };

  const window = createMemo(() => {
    const items = options.items();
    if (options.enabled !== undefined && !options.enabled()) return completeWindow(items);
    return virtualWindow(items, {
      rowSize: options.rowSize,
      viewportSize: viewportSize(),
      scrollOffset: scrollOffset(),
      ...(options.maximumMounted === undefined ? {} : { maximumMounted: options.maximumMounted }),
    });
  });

  const scrollToIndex = (index: number) => {
    const element = container;
    if (element === null || index < 0) return;
    const offset = index * options.rowSize;
    if (horizontal) element.scrollLeft = offset;
    else element.scrollTop = offset;
    measure(element);
  };

  return { window, attach, scrollToIndex };
}
