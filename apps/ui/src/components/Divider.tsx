/**
 * Draggable divider. Reports the pointer delta along its axis since the last move via
 * onResize (the caller turns it into a new panel size); onEnd fires on pointerup so the caller
 * can persist. Pointer capture keeps the drag alive when the cursor leaves the hit area.
 *
 * axis="x" (default): vertical bar, col-resize, reports horizontal delta.
 * axis="y": horizontal bar, row-resize, reports vertical delta — used by the phone layout to
 * resize the pinned board.
 */
interface DividerProps {
  onResize: (delta: number) => void;
  onEnd?: () => void;
  axis?: "x" | "y";
}

export default function Divider(props: DividerProps) {
  let dragging = false;
  let last = 0;
  const horizontal = () => props.axis === "y";

  const onDown = (e: PointerEvent) => {
    dragging = true;
    last = horizontal() ? e.clientY : e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const pos = horizontal() ? e.clientY : e.clientX;
    const d = pos - last;
    if (d === 0) return;
    last = pos;
    props.onResize(d);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    props.onEnd?.();
  };

  return (
    <div
      class={horizontal() ? "divider divider-h" : "divider"}
      role="separator"
      aria-orientation={horizontal() ? "horizontal" : "vertical"}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}
