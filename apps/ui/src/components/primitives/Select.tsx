import { splitProps, type JSX } from "solid-js";

export type SelectProps = JSX.SelectHTMLAttributes<HTMLSelectElement>;

export default function Select(props: SelectProps) {
  const [local, selectProps] = splitProps(props, ["class", "children"]);
  return (
    <select {...selectProps} class={`ui-select${local.class ? ` ${local.class}` : ""}`}>
      {local.children}
    </select>
  );
}
