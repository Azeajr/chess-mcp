/* global window, document, getComputedStyle */

// These functions are serialized into the existing Playwright CLI session. Keep them self-contained.
export async function observe(page, target, options = {}) {
  const { limit = 5, textLimit = 300, css = [], attributes = [] } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("observe limit must be between 1 and 20.");
  if (!Number.isInteger(textLimit) || textLimit < 0 || textLimit > 2000)
    throw new Error("observe textLimit must be between 0 and 2000.");
  for (const fields of [css, attributes])
    if (
      !Array.isArray(fields) ||
      fields.length > 20 ||
      fields.some((field) => typeof field !== "string")
    )
      throw new Error("observe accepts at most 20 CSS properties and 20 attributes.");
  const locator = typeof target === "string" ? page.locator(target) : target;
  return locator.evaluateAll(
    (elements, { limit, textLimit, css, attributes }) => {
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      };
      return {
        viewport,
        count: elements.length,
        truncated: elements.length > limit,
        elements: elements.slice(0, limit).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            !["hidden", "collapse"].includes(style.visibility) &&
            style.display !== "none";
          const text = visible ? (element.innerText ?? element.textContent ?? "") : "";
          const clippedBy = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const parentStyle = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            const x =
              /^(auto|scroll|hidden|clip|overlay)$/.test(parentStyle.overflowX) &&
              (rect.left < box.left || rect.right > box.right);
            const y =
              /^(auto|scroll|hidden|clip|overlay)$/.test(parentStyle.overflowY) &&
              (rect.top < box.top || rect.bottom > box.bottom);
            if ((x || y) && clippedBy.length < 5)
              clippedBy.push({ tag: parent.tagName.toLowerCase(), id: parent.id || null, x, y });
          }
          return {
            tag: element.tagName.toLowerCase(),
            text: text.slice(0, textLimit),
            textTruncated: text.length > textLimit,
            visible,
            inViewport:
              visible &&
              rect.right > 0 &&
              rect.bottom > 0 &&
              rect.left < viewport.width &&
              rect.top < viewport.height,
            outsideViewport: {
              left: rect.left < 0,
              top: rect.top < 0,
              right: rect.right > viewport.width,
              bottom: rect.bottom > viewport.height,
            },
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            focused: element === document.activeElement,
            scroll: {
              left: element.scrollLeft,
              top: element.scrollTop,
              width: element.scrollWidth,
              height: element.scrollHeight,
              clientWidth: element.clientWidth,
              clientHeight: element.clientHeight,
            },
            clippedBy,
            attributes: Object.fromEntries(
              attributes.map((name) => [name, element.getAttribute(name)]),
            ),
            css: Object.fromEntries(css.map((name) => [name, style.getPropertyValue(name)])),
          };
        }),
      };
    },
    { limit, textLimit, css, attributes },
  );
}

export async function readState(page, sections = ["document", "commands", "strategicFit"]) {
  if (
    !Array.isArray(sections) ||
    sections.some((section) => !["document", "commands", "strategicFit"].includes(section))
  )
    throw new Error("state sections: document, commands, strategicFit.");
  return page.evaluate((sections) => {
    const app = window.__chess;
    if (!app) throw new Error("Development state accessors unavailable.");
    const result = {
      url: window.location.href,
      documentId: app.documentId(),
      revision: app.version(),
    };
    if (sections.includes("document"))
      result.document = {
        color: app.color(),
        path: app.currentPath(),
        dirty: app.dirty(),
        changesSinceExport: app.changesSinceExport(),
        fileName: app.fileName() ?? null,
      };
    if (sections.includes("commands"))
      result.commands = Object.fromEntries(
        Object.entries(app.commandStates()).map(([name, command]) => [
          name,
          {
            status: command.status,
            progress: command.progress ?? null,
            error: command.error?.slice(0, 500) ?? null,
            completedAt: command.completedAt ?? null,
            hasResult: command.result !== undefined,
          },
        ]),
      );
    if (sections.includes("strategicFit")) {
      const lifecycle = app.strategicFitLifecycle();
      const current = lifecycle.current_result;
      result.strategicFit = {
        open: app.strategicFitWorkspaceOpen(),
        stage: app.strategicFitWorkspaceStage(),
        metadataStatus: app.strategicFitMetadataStatus(),
        status: lifecycle.status,
        requestId: lifecycle.request_id,
        progress: lifecycle.progress,
        error: lifecycle.error,
        staleReason: lifecycle.stale_reason,
        report: current
          ? {
              id: current.report_id,
              documentId: current.request_snapshot.document_id,
              revision: current.request_snapshot.repertoire_revision,
              findings: current.result.findings.length,
            }
          : null,
      };
    }
    return result;
  }, sections);
}
