import { splitProps, type JSX } from "solid-js";

export interface ProgressProps extends Omit<JSX.IntrinsicElements["progress"], "children"> {
  label?: string;
}

/** The application's single progress primitive. It supports determinate and indeterminate work. */
export default function Progress(props: ProgressProps) {
  const [local, progressProps] = splitProps(props, ["value", "max", "label", "class"]);
  return (
    <progress
      {...progressProps}
      class={`ui-progress${local.value == null ? " is-indeterminate" : ""}${local.class ? ` ${local.class}` : ""}`}
      max={local.max}
      value={local.value}
      aria-label={local.label}
    />
  );
}
