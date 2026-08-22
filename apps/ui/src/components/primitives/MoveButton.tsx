import { splitProps, type JSX } from "solid-js";

export interface MoveButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  current?: boolean;
  previewed?: boolean;
}

export interface MoveTreeItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
  current?: boolean;
  previewed?: boolean;
}

/** A compact native button used for both the tree item and the current-line shortcut. */
export default function MoveButton(props: MoveButtonProps) {
  const [local, buttonProps] = splitProps(props, [
    "class",
    "children",
    "current",
    "previewed",
    "type",
  ]);
  return (
    <button
      {...buttonProps}
      type={local.type ?? "button"}
      class={`move${local.current ? " current" : ""}${local.previewed ? " move-preview" : ""}${local.class ? ` ${local.class}` : ""}`}
    >
      {local.children}
    </button>
  );
}

/** A focusable ARIA tree item; unlike a button, native AT exposes its tree role and level. */
export function MoveTreeItem(props: MoveTreeItemProps) {
  const [local, itemProps] = splitProps(props, ["class", "children", "current", "previewed"]);
  return (
    <div
      {...itemProps}
      class={`move${local.current ? " current" : ""}${local.previewed ? " move-preview" : ""}${local.class ? ` ${local.class}` : ""}`}
    >
      {local.children}
    </div>
  );
}
