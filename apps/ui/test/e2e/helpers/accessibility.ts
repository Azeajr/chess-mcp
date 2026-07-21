import { expect, type Locator } from "playwright/test";

export async function basicAccessibilityViolations(root: Locator): Promise<string[]> {
  return root.evaluate((container) => {
    const issues: string[] = [];
    const document = container.ownerDocument;
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        rect.width > 0 && rect.height > 0;
    };
    const description = (element: Element) => {
      const id = element.id ? `#${element.id}` : "";
      const role = element.getAttribute("role");
      return `${element.tagName.toLowerCase()}${id}${role ? `[role=${role}]` : ""}`;
    };
    const referencedText = (element: Element, attribute: string) =>
      (element.getAttribute(attribute) ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    const accessibleName = (element: Element) => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;
      const labelled = referencedText(element, "aria-labelledby");
      if (labelled) return labelled;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLOutputElement
      ) {
        const labels = [...(element.labels ?? [])]
          .map((label) => label.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (labels) return labels;
      }
      if (element instanceof HTMLImageElement && element.alt.trim()) return element.alt.trim();
      if (element instanceof HTMLInputElement && element.value.trim() &&
        ["button", "reset", "submit"].includes(element.type)) return element.value.trim();
      return element.textContent?.trim() || element.getAttribute("title")?.trim() || "";
    };

    const ids = new Map<string, number>();
    for (const element of [container, ...container.querySelectorAll("[id]")]) {
      if (!element.id) continue;
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) issues.push(`duplicate id #${id}`);
    }

    for (const element of container.querySelectorAll("[aria-labelledby], [aria-describedby], [aria-controls]")) {
      for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls"] as const) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        for (const id of value.split(/\s+/u).filter(Boolean)) {
          if (!document.getElementById(id)) {
            issues.push(`${description(element)} has missing ${attribute} reference #${id}`);
          }
        }
      }
    }

    const namedSelectors = [
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
      "[role='img']",
      "[role='dialog']",
      "[role='region']",
      "[role='tabpanel']",
    ].join(",");
    for (const element of container.querySelectorAll(namedSelectors)) {
      if (visible(element) && !accessibleName(element)) {
        issues.push(`${description(element)} has no accessible name`);
      }
    }

    const headings = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter(visible);
    if (headings.length === 0 || headings[0]!.tagName !== "H1") {
      issues.push("visible heading outline does not start with h1");
    }
    let previousLevel = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      if (!heading.textContent?.trim()) issues.push(`${description(heading)} is empty`);
      if (previousLevel > 0 && level > previousLevel + 1) {
        issues.push(`heading level jumps from h${previousLevel} to h${level}: ${heading.textContent?.trim()}`);
      }
      previousLevel = level;
    }

    for (const table of container.querySelectorAll("table")) {
      if (!visible(table)) continue;
      if (!table.querySelector("caption") && !accessibleName(table)) {
        issues.push(`${description(table)} has no caption or accessible name`);
      }
      if (!table.querySelector("th")) issues.push(`${description(table)} has no header cells`);
    }

    for (const tablist of container.querySelectorAll("[role='tablist']")) {
      if (!visible(tablist)) continue;
      const tabs = [...tablist.querySelectorAll("[role='tab']")];
      if (tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length !== 1) {
        issues.push(`${description(tablist)} does not have exactly one selected tab`);
      }
      for (const tab of tabs) {
        const panelId = tab.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        if (!panel || panel.getAttribute("role") !== "tabpanel") {
          issues.push(`${description(tab)} does not control a tabpanel`);
        } else if (!(panel.getAttribute("aria-labelledby") ?? "").split(/\s+/u).includes(tab.id)) {
          issues.push(`${description(panel)} is not labelled by ${description(tab)}`);
        }
      }
    }

    for (const live of container.querySelectorAll("[role='status'][aria-live]")) {
      if (visible(live)) issues.push(`${description(live)} duplicates status and aria-live semantics`);
    }

    return issues;
  });
}

export async function expectBasicAccessibility(root: Locator): Promise<void> {
  expect(await basicAccessibilityViolations(root)).toEqual([]);
}

export async function touchTargetViolations(root: Locator, minimum = 44): Promise<string[]> {
  return root.evaluate((container, min) => {
    const issues: string[] = [];
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        rect.width > 0 && rect.height > 0;
    };
    for (const candidate of container.querySelectorAll<HTMLElement>(
      "button, select, summary, textarea, input:not([type='hidden'])",
    )) {
      if (!visible(candidate) || candidate.matches(":disabled")) continue;
      const input = candidate instanceof HTMLInputElement ? candidate : null;
      const target = input && ["checkbox", "radio"].includes(input.type)
        ? candidate.closest<HTMLElement>("label") ?? candidate
        : candidate;
      const rect = target.getBoundingClientRect();
      if (rect.width + 0.01 < min || rect.height + 0.01 < min) {
        const name = candidate.getAttribute("aria-label") ??
          candidate.textContent?.trim() ?? input?.name ?? candidate.tagName.toLowerCase();
        issues.push(`${name}: ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`);
      }
    }
    return issues;
  }, minimum);
}

export async function contrastViolations(root: Locator): Promise<string[]> {
  return root.evaluate((container) => {
    const parseColor = (value: string): [number, number, number, number] | null => {
      const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/u);
      return match
        ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
        : null;
    };
    const luminance = ([red, green, blue]: readonly number[]) => {
      const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const background = (element: HTMLElement) => {
      let current: HTMLElement | null = element;
      while (current) {
        const parsed = parseColor(getComputedStyle(current).backgroundColor);
        if (parsed && parsed[3] >= 0.99) return parsed;
        current = current.parentElement;
      }
      return [255, 255, 255, 1] as [number, number, number, number];
    };
    const issues: string[] = [];
    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none" || style.visibility === "hidden" ||
        rect.width === 0 || rect.height === 0 ||
        element.closest(":disabled") || Number(style.opacity) < 0.99 ||
        ![...element.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        )
      ) continue;
      const foreground = parseColor(style.color);
      if (!foreground || foreground[3] < 0.99) continue;
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background(element));
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      if (ratio + 0.01 < threshold) {
        issues.push(`${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 48)}": ${ratio.toFixed(2)}:1`);
      }
    }
    return issues;
  });
}
