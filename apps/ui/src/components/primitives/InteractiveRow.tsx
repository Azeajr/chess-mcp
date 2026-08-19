import { splitProps, type JSX } from "solid-js";

export interface InteractiveRowProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  current?: boolean;
}

/**
 * A compact, full-row action. Keeping this a native button gives every repertoire result the
 * same click, Enter, and Space behavior without making its text layout any taller.
 */
export default function InteractiveRow(props: InteractiveRowProps) {
  const [local, buttonProps] = splitProps(props, ["class", "children", "current", "type"]);
  return (
    <button
      {...buttonProps}
      type={local.type ?? "button"}
      class={`rep-row${local.class ? ` ${local.class}` : ""}`}
      aria-current={local.current ? "true" : undefined}
    >
      {local.children}
    </button>
  );
}
