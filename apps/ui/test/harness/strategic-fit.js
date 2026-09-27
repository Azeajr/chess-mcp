// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The controller evaluates this function expression.
async (page, { step, assert, observe, state }) => {
  const before = await state(["document"]);
  await step("Open Strategic Fit", async () => {
    await page.getByRole("button", { name: "Open Strategic Fit" }).click({ timeout: 10000 });
    await page.getByRole("button", { name: "Use Balanced profile" }).waitFor({ timeout: 10000 });
  });
  const profile = await observe(page.getByRole("button", { name: "Use Balanced profile" }), {
    attributes: ["disabled"],
    css: ["font-size"],
  });
  await step("Choose profile and return", async () => {
    await page.getByRole("button", { name: "Use Balanced profile" }).click({ timeout: 10000 });
    await page.getByRole("button", { name: "Return to repertoire" }).click({ timeout: 10000 });
    await page.getByRole("button", { name: "Open Strategic Fit" }).waitFor({ timeout: 10000 });
  });
  const after = await state();
  assert(after.documentId === before.documentId, "Document identity changed");
  assert(after.revision === before.revision, "Document revision changed");
  assert(!after.strategicFit.open, "Strategic Fit remained open");
  return { profile, after };
};
