import { splitProps, type JSX } from "solid-js";

export interface FieldProps extends JSX.LabelHTMLAttributes<HTMLLabelElement> {
  label: string;
  hint?: string;
}

export default function Field(props: FieldProps) {
  const [local, labelProps] = splitProps(props, ["label", "hint", "class", "children"]);
  return (
    <label {...labelProps} class={`ui-field${local.class ? ` ${local.class}` : ""}`}>
      <span class="ui-field-label">{local.label}</span>
      {local.children}
      {local.hint ? <span class="ui-field-hint">{local.hint}</span> : null}
    </label>
  );
}
