import { splitProps, type JSX } from "solid-js";

export type StatusTone = "neutral" | "running" | "success" | "warning" | "danger" | "info";

export interface StatusProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export default function Status(props: StatusProps) {
  const [local, statusProps] = splitProps(props, ["tone", "class", "children"]);
  return (
    <span
      {...statusProps}
      class={`ui-status ui-status-${local.tone ?? "neutral"}${local.class ? ` ${local.class}` : ""}`}
    >
      {local.children}
    </span>
  );
}
