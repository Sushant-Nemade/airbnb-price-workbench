import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import Papa from "papaparse";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("price")).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("status")).toContainText("Estimate ready");
}
async function form(page: Page) {
  if ((await page.locator(".input-details").getAttribute("open")) === null)
    await page.locator(".input-details summary").click();
}

test("actual browser model matches Python API and chart/image render", async ({
  page,
  request,
}) => {
  await ready(page);
  const response = await request.post("/api/predict", {
    data: {
      borough: "Brooklyn",
      room_type: "Entire home/apt",
      latitude: 40.695,
      longitude: -73.98,
      minimum_nights: 3,
      number_of_reviews: 25,
      reviews_per_month: 1.2,
      availability_365: 180,
    },
  });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  const value = Number(
    (await page.getByTestId("price").innerText()).replace(/[^\d.]/g, ""),
  );
  expect(Math.abs(value - result.price_usd)).toBeLessThan(0.03);
  await expect(
    page.getByText("USD / night, 2019 listing benchmark"),
  ).toBeVisible();
  expect(
    await page
      .locator(".city-banner img")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 400,
      ),
  ).toBeTruthy();
  await expect
    .poll(() =>
      page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const values = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return [...values].some((value, index) => index % 4 === 3 && value > 0);
      }),
    )
    .toBeTruthy();
});

test("browser predictions match all authored sklearn probes", async ({
  page,
  request,
}) => {
  await ready(page);
  const probes = await (await request.get("/parity.json")).json();
  expect(probes.length).toBe(30);
  await page.getByRole("tab", { name: "Batch CSV", exact: true }).click();
  const csv = Papa.unparse(
    probes.map((probe: { input: Record<string, unknown> }) => probe.input),
  );
  await page
    .getByLabel("Upload scenario CSV")
    .setInputFiles({
      name: "authored-parity.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(page.getByRole("status")).toContainText(
    "30 predicted, 0 rejected",
  );
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(30);
  for (let index = 0; index < probes.length; index++) {
    const displayed = Number(
      (await rows.nth(index).locator("td").first().innerText()).replace(
        /[^\d.]/g,
        "",
      ),
    );
    expect(Math.abs(displayed - probes[index].expected_price)).toBeLessThan(
      0.03,
    );
  }
});

test("saved scenario survives reload and can be reopened and deleted", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("saved in this browser");
  await page.reload();
  await expect(page.getByTestId("price")).toBeVisible();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Brooklyn scenario" }).click();
  await expect(page.getByTestId("price")).toBeVisible();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Delete Brooklyn scenario" }).click();
  await expect(page.getByText("No saved scenarios.")).toBeVisible();
});

test("local CSV validates rows and exports estimates", async ({ page }) => {
  await ready(page);
  await page.getByRole("tab", { name: "Batch CSV", exact: true }).click();
  const csv =
    "borough,room_type,latitude,longitude,minimum_nights,number_of_reviews,reviews_per_month,availability_365\nBrooklyn,Entire home/apt,40.695,-73.98,3,25,1.2,180\nLondon,Entire home/apt,40.695,-73.98,3,25,1.2,180\n";
  await page
    .getByLabel("Upload scenario CSV")
    .setInputFiles({
      name: "scenarios.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(page.getByRole("status")).toContainText(
    "1 predicted, 1 rejected",
  );
  await expect(
    page.getByText("Invalid or out-of-scope input row"),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download batch results" }).click();
  expect((await pending).suggestedFilename()).toBe("airbnb-batch-results.csv");
});

test("evidence and keyboard tabs expose model limitations", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("tab", { name: "Estimate", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Batch CSV", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("heading", { name: "Measured model evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Host-disjoint partitions" }),
  ).toBeVisible();
  await expect(page.getByText(/Historical 2019 snapshot/)).toBeVisible();
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
    4,
  );
});

test("invalid inputs are rejected and JSON export is real output", async ({
  page,
}) => {
  await ready(page);
  await form(page);
  await page.getByLabel("Minimum nights", { exact: true }).fill("31");
  await page
    .getByRole("button", { name: "Estimate nightly price", exact: true })
    .click();
  expect(
    await page
      .getByLabel("Minimum nights", { exact: true })
      .evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBeFalsy();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download estimate JSON" }).click();
  expect((await pending).suggestedFilename()).toBe("airbnb-estimate.json");
});

test("tampered model fails closed and retry recovers", async ({ page }) => {
  let tamper = true;
  await page.route("**/price-model.onnx", async (route) => {
    if (tamper) await route.fulfill({ body: Buffer.from("modified model") });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Model unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("checksum failed");
  tamper = false;
  await page.getByRole("button", { name: "Retry model loading" }).click();
  await expect(page.getByTestId("price")).toBeVisible({ timeout: 45000 });
});

test("all views fit a 320px viewport and capture rendered output", async ({
  page,
}, testInfo) => {
  await ready(page);
  await page.setViewportSize({ width: 320, height: 850 });
  for (const name of ["Estimate", "Model evidence", "Batch CSV", "Saved"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("tab", { name: "Estimate", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("workbench-320.png"),
    fullPage: true,
  });
});
