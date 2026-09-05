import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { virtualWindow, type VirtualWindow } from "./visualization-limits";

export const VIRTUAL_TABLE_ROW_HEIGHT = 36;

export const VIRTUAL_TABLE_COLUMN_WIDTH = 132;

export interface VirtualRowsOptions<T> {
  readonly items: Accessor<readonly T[]>;
  readonly rowSize: number;
  readonly enabled?: Accessor<boolean>;
  readonly maximumMounted?: number;
  readonly axis?: "vertical" | "horizontal";
}

export interface VirtualRows<T> {
  readonly window: Accessor<VirtualWindow<T>>;
  readonly attach: (element: HTMLElement) => void;
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
