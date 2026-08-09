import { splitProps, type JSX } from "solid-js";

export interface PanelHeaderProps extends JSX.HTMLAttributes<HTMLElement> {
  kicker?: string;
  title?: string;
  titleId?: string;
  titleTag?: "h1" | "h2" | "h3";
}

export default function PanelHeader(props: PanelHeaderProps) {
  const [local, headerProps] = splitProps(props, [
    "kicker",
    "title",
    "titleId",
    "titleTag",
    "class",
    "children",
  ]);
  return (
    <header {...headerProps} class={`panel-header${local.class ? ` ${local.class}` : ""}`}>
      {local.kicker ? <span class="panel-header-kicker">{local.kicker}</span> : null}
      {local.title ? (
        local.titleTag === "h1" ? (
          <h1 id={local.titleId}>{local.title}</h1>
        ) : local.titleTag === "h3" ? (
          <h3 id={local.titleId}>{local.title}</h3>
        ) : (
          <h2 id={local.titleId}>{local.title}</h2>
        )
      ) : null}
      {local.children}
    </header>
  );
}
