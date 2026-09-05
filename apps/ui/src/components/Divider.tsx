interface DividerProps {
  onResize: (delta: number) => void;
  onEnd?: () => void;
  onReset: () => void;
  axis?: "x" | "y";
  label: string;
  value: number;
  min: number;
  max: number;
  valueDirection?: 1 | -1;
}

export default function Divider(props: DividerProps) {
  let dragging = false;
  let keyboardChanged = false;
  let last = 0;
  const horizontal = () => props.axis === "y";
  const valueDirection = () => props.valueDirection ?? 1;

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
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    let delta: number | undefined;
    if (!horizontal() && e.key === "ArrowLeft") delta = -step;
    else if (!horizontal() && e.key === "ArrowRight") delta = step;
    else if (horizontal() && e.key === "ArrowUp") delta = -step;
    else if (horizontal() && e.key === "ArrowDown") delta = step;
    else if (e.key === "Home") delta = -Number.MAX_SAFE_INTEGER * valueDirection();
    else if (e.key === "End") delta = Number.MAX_SAFE_INTEGER * valueDirection();
    else if (e.key === "Enter") {
      props.onReset();
      keyboardChanged = true;
    } else return;

    e.preventDefault();
    e.stopPropagation();
    if (delta !== undefined) props.onResize(delta);
    keyboardChanged = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const handled = horizontal()
      ? ["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(e.key)
      : ["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key);
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!keyboardChanged) return;
    keyboardChanged = false;
    props.onEnd?.();
  };
  const onDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    props.onReset();
    props.onEnd?.();
  };

  return (
    <div
      class={horizontal() ? "divider divider-h" : "divider"}
      role="separator"
      aria-orientation={horizontal() ? "horizontal" : "vertical"}
      aria-label={props.label}
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDblClick={onDoubleClick}
    />
  );
}
