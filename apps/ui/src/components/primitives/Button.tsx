import { splitProps, type JSX } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  danger?: boolean;
}

export default function Button(props: ButtonProps) {
  const [local, buttonProps] = splitProps(props, ["variant", "danger", "class", "children"]);
  return (
    <button
      {...buttonProps}
      class={`ui-button ui-button-${local.variant ?? "secondary"}${local.danger ? " ui-button-danger" : ""}${local.class ? ` ${local.class}` : ""}`}
    >
      {local.children}
    </button>
  );
}
