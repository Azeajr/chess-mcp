import { splitProps, type JSX } from "solid-js";

export interface MoveButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  current?: boolean;
  previewed?: boolean;
}

export interface MoveTreeItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
  current?: boolean;
  previewed?: boolean;
}

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
