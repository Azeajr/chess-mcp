/**
 * Draggable vertical divider. Reports the horizontal pointer delta since the last move via
 * onResize (the caller turns it into a new panel width); onEnd fires on pointerup so the caller
 * can persist. Pointer capture keeps the drag alive when the cursor leaves the 5px hit area.
 */
interface DividerProps {
  onResize: (deltaPx: number) => void;
  onEnd?: () => void;
}

export default function Divider(props: DividerProps) {
  let dragging = false;
  let lastX = 0;

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    if (dx === 0) return;
    lastX = e.clientX;
    props.onResize(dx);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    props.onEnd?.();
  };

  return (
    <div
      class="divider"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}
