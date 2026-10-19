import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./workbench.css";
import { Chart, registerables } from "chart.js";
import Papa from "papaparse";
import {
  createElement,
  Building2,
  ArrowRight,
  Download,
  Save,
  Trash2,
  Upload,
  RefreshCw,
  ExternalLink,
  FileSpreadsheet,
} from "lucide";
import type { IconNode } from "lucide";
import { z } from "zod";
import {
  boroughs,
  centers,
  defaults,
  listingSchema,
  numeric,
  parseListingRow,
  PriceEngine,
  rooms,
} from "./engine";
import type { Estimate, Listing } from "./engine";

Chart.register(...registerables);
const SOURCE = "https://github.com/Sushant-Nemade/airbnb-price-workbench";
const STORAGE = "airbnb-prices.scenarios.v1";
const views = ["Estimate", "Batch CSV", "Model evidence", "Saved"] as const;
type View = (typeof views)[number];
let engine: PriceEngine | undefined,
  current: Estimate | undefined,
  view: View = "Estimate",
  busy = false,
  chart: Chart | undefined;
let batch: Array<{ row: number; result?: Estimate; error?: string }> = [];
let batchName = "";
const fields: Partial<
  Record<keyof Listing, HTMLInputElement | HTMLSelectElement>
> = {};
const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: unknown[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("on"))
      node.addEventListener(
        name.slice(2).toLowerCase(),
        value as EventListener,
      );
    else if (name === "class") node.className = String(value);
    else if (["value", "disabled", "checked", "open"].includes(name))
      (node as unknown as Record<string, unknown>)[name] = value;
    else node.setAttribute(name, String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return node;
}
function button(
  label: string,
  icon: IconNode,
  action: () => void,
  attrs: Record<string, unknown> = {},
) {
  return el(
    "button",
    {
      type: "button",
      class: "icon-button",
      title: label,
      "aria-label": label,
      onClick: action,
      ...attrs,
    },
    createElement(icon),
  );
}
function safeLink(label: string, url: string) {
  const address = new URL(url);
  if (address.protocol !== "https:" || address.username || address.password)
    throw new Error("Invalid source link");
  return el(
    "a",
    { href: url, target: "_blank", rel: "noreferrer" },
    label,
    createElement(ExternalLink),
  );
}
const status = el(
  "p",
  { class: "status-message", role: "status", "aria-live": "polite" },
  "Loading verified model...",
);
const main = el("main", { class: "workspace", id: "workspace" });
const badge = el("span", { class: "model-badge" }, "Model loading");
const form = el("form", {
  id: "listing-form",
  onSubmit: (event: Event) => {
    event.preventDefault();
    void predict();
  },
});
function field(
  label: string,
  name: keyof Listing,
  min: number,
  max: number,
  step: string,
  value: number,
) {
  const input = el("input", {
    id: name,
    type: "number",
    name,
    min,
    max,
    step,
    value,
    required: true,
  });
  fields[name] = input;
  return el(
    "label",
    { class: "field", for: name },
    el("span", {}, label),
    input,
  );
}
function select(
  label: string,
  name: "borough" | "room_type",
  values: readonly string[],
) {
  const input = el(
    "select",
    { id: name, name, "aria-label": label },
    values.map((value) => el("option", { value }, value)),
  );
  fields[name] = input;
  return el(
    "label",
    { class: "field", for: name },
    el("span", {}, label),
    input,
  );
}
const submit = el(
  "button",
  { type: "submit", class: "primary", disabled: true },
  "Estimate nightly price",
  createElement(ArrowRight),
);
form.append(
  select("Borough", "borough", boroughs),
  select("Room type", "room_type", rooms),
  el(
    "div",
    { class: "field-row" },
    field("Latitude", "latitude", 40.49, 40.92, "0.0001", defaults.latitude),
    field(
      "Longitude",
      "longitude",
      -74.26,
      -73.7,
      "0.0001",
      defaults.longitude,
    ),
  ),
  field(
    "Minimum nights",
    "minimum_nights",
    1,
    30,
    "1",
    defaults.minimum_nights,
  ),
  field(
    "Number of reviews",
    "number_of_reviews",
    0,
    700,
    "1",
    defaults.number_of_reviews,
  ),
  field(
    "Reviews per month",
    "reviews_per_month",
    0,
    60,
    "0.01",
    defaults.reviews_per_month,
  ),
  field(
    "Available days / year",
    "availability_365",
    0,
    365,
    "1",
    defaults.availability_365,
  ),
  submit,
);
fields.borough!.addEventListener("change", () => {
  const [latitude, longitude] =
    centers[fields.borough!.value as Listing["borough"]];
  fields.latitude!.value = String(latitude);
  fields.longitude!.value = String(longitude);
});
const details = el(
  "details",
  { class: "input-details", open: innerWidth >= 900 },
  el("summary", {}, "Listing inputs"),
  form,
);
const sidebar = el(
  "aside",
  { class: "sidebar" },
  details,
  el(
    "div",
    { class: "scope-note" },
    el("strong", {}, "NYC / 2019"),
    el(
      "p",
      {},
      "Historical advertised prices. Not current rates, booking availability or a revenue guarantee.",
    ),
  ),
);
const tabs = el("nav", {
  class: "tabs",
  role: "tablist",
  "aria-label": "Workbench views",
});
function drawTabs() {
  tabs.replaceChildren(
    ...views.map((name, index) =>
      el(
        "button",
        {
          type: "button",
          role: "tab",
          id: `tab-${index}`,
          "aria-controls": "view-panel",
          "aria-selected": view === name,
          tabindex: view === name ? 0 : -1,
          class: view === name ? "active" : "",
          onClick: () => {
            if (!busy) {
              view = name;
              render();
            }
          },
          onKeydown: (event: KeyboardEvent) => {
            let target = index;
            if (event.key === "ArrowRight") target = (index + 1) % views.length;
            else if (event.key === "ArrowLeft")
              target = (index + views.length - 1) % views.length;
            else if (event.key === "Home") target = 0;
            else if (event.key === "End") target = views.length - 1;
            else return;
            event.preventDefault();
            if (busy) return;
            view = views[target];
            render();
            (tabs.children[target] as HTMLElement).focus();
          },
        },
        name,
      ),
    ),
  );
}
function announce(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}
function readForm() {
  const values: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(fields))
    values[name] = (numeric as readonly string[]).includes(name)
      ? Number(input.value)
      : input.value;
  return listingSchema.parse(values);
}
function fillForm(listing: Listing) {
  for (const [name, input] of Object.entries(fields))
    input.value = String(listing[name as keyof Listing]);
}
function exportText(name: string, text: string, type: string) {
  const address = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a", { href: address, download: name });
  link.click();
  URL.revokeObjectURL(address);
}
async function predict(listing?: Listing) {
  if (!engine || busy || (!listing && !form.reportValidity())) return;
  busy = true;
  submit.disabled = true;
  main.setAttribute("aria-busy", "true");
  try {
    const values = listing ?? readForm();
    current = (await engine.predict([values]))[0];
    view = "Estimate";
    render();
    announce("Estimate ready. Historical 2019 scope.");
    if (innerWidth < 900) details.open = false;
  } catch (error) {
    announce(
      error instanceof z.ZodError
        ? "Check the listing input limits."
        : error instanceof Error
          ? error.message
          : "Prediction failed.",
      true,
    );
  } finally {
    busy = false;
    submit.disabled = false;
    main.removeAttribute("aria-busy");
  }
}
function savedScenarios(): Array<{ id: string; input: Listing }> {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return [];
  if (raw.length > 100000)
    throw new Error("Saved scenarios exceed the storage limit.");
  return z
    .array(z.object({ id: z.uuid(), input: listingSchema }))
    .max(20)
    .parse(JSON.parse(raw));
}
function save() {
  if (!current || busy) return;
  try {
    const scenarios = savedScenarios();
    scenarios.unshift({ id: crypto.randomUUID(), input: current.input });
    localStorage.setItem(STORAGE, JSON.stringify(scenarios.slice(0, 20)));
    announce("Scenario saved in this browser.");
  } catch {
    announce(
      "Browser storage is unavailable or invalid. Existing data was not overwritten.",
      true,
    );
  }
}
function stat(label: string, value: string) {
  return el("div", {}, el("span", {}, label), el("strong", {}, value));
}
function renderEstimate(panel: HTMLElement) {
  if (!engine || !current) {
    panel.append(el("p", {}, "Model is not ready."));
    return;
  }
  const result = current,
    report = engine.report;
  panel.append(
    el(
      "section",
      { class: "estimate-band" },
      el(
        "div",
        {},
        el("span", { class: "eyebrow" }, "HISTORICAL NIGHTLY ESTIMATE"),
        el(
          "div",
          { class: "price", "data-testid": "price" },
          dollars(result.price_usd),
        ),
        el("p", { class: "muted" }, "USD / night, 2019 listing benchmark"),
      ),
      el(
        "div",
        { class: "interval" },
        el("span", { class: "eyebrow" }, "90% TARGET CALIBRATION BAND"),
        el(
          "strong",
          { "data-testid": "interval" },
          `${dollars(result.lower_usd)} - ${dollars(result.upper_usd)}`,
        ),
        el(
          "p",
          {},
          "Historical marginal coverage, not an individual guarantee.",
        ),
      ),
    ),
  );
  panel.append(
    el(
      "div",
      { class: "scenario-line" },
      el("strong", {}, result.input.borough),
      el("span", {}, result.input.room_type),
      el("span", {}, `${result.input.minimum_nights} night minimum`),
    ),
    el(
      "div",
      { class: "stat-strip" },
      stat("Held-out MAE", dollars(report.evaluation.test.mae_usd)),
      stat(
        "Median baseline MAE",
        dollars(report.evaluation.baselines.global_median.mae_usd),
      ),
      stat(
        "Observed coverage",
        `${(report.evaluation.interval_coverage * 100).toFixed(1)}%`,
      ),
    ),
  );
  const canvas = el("canvas", {
    "aria-label": "Held-out mean absolute error compared with baselines",
    role: "img",
  });
  panel.append(
    el(
      "section",
      { class: "chart-section" },
      el(
        "div",
        { class: "section-heading" },
        el("h2", {}, "Model vs. baselines"),
        el("span", { class: "muted" }, "Lower MAE is better"),
      ),
      el("div", { class: "chart-wrap" }, canvas),
    ),
  );
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Global median", "Borough / room", "Trained model"],
        datasets: [
          {
            data: [
              report.evaluation.baselines.global_median.mae_usd,
              report.evaluation.baselines.borough_room_median.mae_usd,
              report.evaluation.test.mae_usd,
            ],
            backgroundColor: ["#bbc4c5", "#dba797", "#267c73"],
            borderRadius: 3,
            barThickness: 24,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (context) => dollars(Number(context.raw)) },
          },
        },
        scales: {
          x: {
            min: 0,
            title: { display: true, text: "Mean absolute error (2019 USD)" },
          },
          y: { grid: { display: false } },
        },
      },
    });
  });
  panel.append(
    el(
      "section",
      { class: "notes" },
      el("h2", {}, "Interpretation"),
      el(
        "p",
        {},
        "The model estimates advertised prices within a filtered historical NYC dataset. It does not include cleaning/service fees, taxes, bookings, demand shifts or current regulations.",
      ),
      el(
        "p",
        {},
        "Borough and coordinates must describe the same location. Numeric bounds do not establish address, zoning or listing eligibility.",
      ),
    ),
  );
}
function table(headings: string[], rows: string[][]) {
  const body = el("tbody");
  for (const row of rows)
    body.append(
      el(
        "tr",
        {},
        row.map((value, index) =>
          index === 0 ? el("th", { scope: "row" }, value) : el("td", {}, value),
        ),
      ),
    );
  return el(
    "div",
    { class: "table-scroll" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          headings.map((label) => el("th", { scope: "col" }, label)),
        ),
      ),
      body,
    ),
  );
}
function renderEvidence(panel: HTMLElement) {
  if (!engine) return;
  const report = engine.report;
  panel.append(
    el("h2", {}, "Measured model evidence"),
    el(
      "p",
      { class: "muted" },
      `${report.dataset.source_rows.toLocaleString()} source rows / ${report.dataset.eligible_rows.toLocaleString()} eligible / ${report.dataset.excluded_rows} excluded by fixed filters.`,
    ),
    el(
      "div",
      { class: "stat-strip" },
      stat("Test MAE", dollars(report.evaluation.test.mae_usd)),
      stat("Test RMSE", dollars(report.evaluation.test.rmse_usd)),
      stat("Test R-squared", report.evaluation.test.r2.toFixed(3)),
    ),
  );
  const splitRows = Object.entries(report.splits).map(([name, split]) => [
    name,
    String(split.rows),
    String(split.hosts),
  ]);
  panel.append(
    el("h3", {}, "Host-disjoint partitions"),
    table(["Partition", "Listings", "Hosts"], splitRows),
    el(
      "p",
      { class: "muted" },
      "Model selection, interval calibration and final testing use separate host groups. This is not a future-date or held-out-region evaluation.",
    ),
    el("h3", {}, "Test error by segment"),
    table(
      ["Segment", "Rows", "MAE", "Coverage"],
      report.evaluation.slices.map((slice) => [
        slice.value,
        String(slice.rows),
        dollars(slice.mae_usd),
        `${(slice.interval_coverage * 100).toFixed(1)}%`,
      ]),
    ),
  );
  panel.append(
    el("h3", {}, "Source & integrity"),
    el(
      "p",
      {},
      safeLink(
        "Kaggle dataset / CC0 publisher metadata",
        report.dataset.source,
      ),
    ),
    el("p", { class: "hash" }, `Model SHA-256: ${report.model_sha256}`),
    el("p", { class: "hash" }, `Dataset SHA-256: ${report.dataset.sha256}`),
    el(
      "ul",
      { class: "limitations" },
      report.limitations.map((text) => el("li", {}, text)),
    ),
    el(
      "p",
      {},
      safeLink("Original implementation & model documentation", SOURCE),
    ),
  );
}
function template() {
  return Papa.unparse({
    fields: ["borough", "room_type", ...numeric],
    data: [
      [
        defaults.borough,
        defaults.room_type,
        ...numeric.map((name) => defaults[name]),
      ],
    ],
  });
}
async function processFile(file: File) {
  if (!engine || busy) return;
  if (file.size > 1000000) {
    announce("CSV exceeds 1 MB.", true);
    return;
  }
  busy = true;
  submit.disabled = true;
  batch = [];
  batchName = file.name.slice(0, 100);
  announce("Validating batch...");
  try {
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: "greedy",
    });
    if (
      parsed.errors.length ||
      (parsed.meta.renamedHeaders &&
        Object.keys(parsed.meta.renamedHeaders).length)
    )
      throw new Error("CSV has malformed or duplicate headers.");
    if (parsed.data.length < 1 || parsed.data.length > 100)
      throw new Error("CSV must contain 1-100 scenarios.");
    const valid: Listing[] = [],
      positions: number[] = [];
    for (const [rowIndex, row] of parsed.data.entries()) {
      try {
        valid.push(parseListingRow(row));
        positions.push(rowIndex);
        batch.push({ row: rowIndex + 2 });
      } catch {
        batch.push({
          row: rowIndex + 2,
          error: "Invalid or out-of-scope input row",
        });
      }
    }
    const predictions = valid.length ? await engine.predict(valid) : [];
    predictions.forEach((result, index) => {
      batch[positions[index]].result = result;
    });
    announce(
      `Batch complete: ${valid.length} predicted, ${batch.length - valid.length} rejected.`,
    );
    render();
  } catch (error) {
    batch = [];
    announce(error instanceof Error ? error.message : "Batch failed.", true);
    render();
  } finally {
    busy = false;
    submit.disabled = false;
  }
}
function renderBatch(panel: HTMLElement) {
  panel.append(
    el(
      "div",
      { class: "section-heading" },
      el("h2", {}, "Local batch prediction"),
      button("Download CSV template", FileSpreadsheet, () =>
        exportText("airbnb-input-template.csv", template(), "text/csv"),
      ),
    ),
    el(
      "p",
      { class: "muted" },
      "Historical scenarios / maximum 100 rows, 1 MB / processed in this browser.",
    ),
  );
  const input = el("input", {
    type: "file",
    id: "batch-file",
    accept: ".csv,text/csv",
    "aria-label": "Upload scenario CSV",
    onChange: () => {
      const file = input.files?.[0];
      if (file) void processFile(file);
    },
  });
  panel.append(
    el(
      "label",
      { class: "upload", for: "batch-file" },
      createElement(Upload),
      el("span", {}, "Choose scenario CSV"),
      input,
    ),
  );
  if (batch.length) {
    const download = button("Download batch results", Download, () => {
      const rows = batch.map((item) => ({
        row: item.row,
        price_usd: item.result?.price_usd ?? "",
        lower_usd: item.result?.lower_usd ?? "",
        upper_usd: item.result?.upper_usd ?? "",
        status: item.error ?? "historical_2019_estimate",
      }));
      exportText(
        "airbnb-batch-results.csv",
        Papa.unparse(rows, { escapeFormulae: true }),
        "text/csv",
      );
    });
    panel.append(
      el(
        "div",
        { class: "section-heading" },
        el("p", { class: "filename" }, batchName),
        download,
      ),
      table(
        ["CSV row", "Estimate", "Band", "Status"],
        batch.map((item) => [
          String(item.row),
          item.result ? dollars(item.result.price_usd) : "-",
          item.result
            ? `${dollars(item.result.lower_usd)} - ${dollars(item.result.upper_usd)}`
            : "-",
          item.error ?? "Predicted",
        ]),
      ),
    );
  }
}
function renderSaved(panel: HTMLElement) {
  panel.append(el("h2", {}, "Saved browser scenarios"));
  let saved;
  try {
    saved = savedScenarios();
  } catch {
    panel.append(
      el(
        "p",
        { class: "error" },
        "Stored scenarios are invalid. Existing data was not deleted.",
      ),
    );
    return;
  }
  if (!saved.length)
    panel.append(el("p", { class: "muted" }, "No saved scenarios."));
  for (const item of saved) {
    const reopen = button(
      `Reopen ${item.input.borough} scenario`,
      ArrowRight,
      () => {
        fillForm(item.input);
        void predict(item.input);
      },
    );
    const remove = button(
      `Delete ${item.input.borough} scenario`,
      Trash2,
      () => {
        if (busy) return;
        try {
          localStorage.setItem(
            STORAGE,
            JSON.stringify(
              savedScenarios().filter((value) => value.id !== item.id),
            ),
          );
          render();
          announce("Saved scenario deleted.");
        } catch {
          announce("Unable to update browser storage.", true);
        }
      },
    );
    panel.append(
      el(
        "article",
        { class: "saved-row" },
        el(
          "div",
          {},
          el("strong", {}, item.input.borough),
          el(
            "p",
            { class: "muted" },
            `${item.input.room_type} / ${item.input.number_of_reviews} reviews`,
          ),
        ),
        reopen,
        remove,
      ),
    );
  }
}
function render() {
  chart?.destroy();
  chart = undefined;
  drawTabs();
  const panel = el("section", {
    id: "view-panel",
    role: "tabpanel",
    "aria-labelledby": `tab-${views.indexOf(view)}`,
    class: "view-content",
  });
  if (view === "Estimate") renderEstimate(panel);
  else if (view === "Batch CSV") renderBatch(panel);
  else if (view === "Model evidence") renderEvidence(panel);
  else renderSaved(panel);
  const heading = el(
    "div",
    { class: "workspace-heading" },
    el(
      "div",
      {},
      el("p", { class: "eyebrow" }, "NYC / HISTORICAL MODEL WORKSPACE"),
      el("h1", {}, "Airbnb price estimate"),
    ),
    el(
      "div",
      { class: "tools" },
      button("Save scenario", Save, save, { disabled: !current }),
      button(
        "Download estimate JSON",
        Download,
        () => {
          if (current)
            exportText(
              "airbnb-estimate.json",
              JSON.stringify(current, null, 2),
              "application/json",
            );
        },
        { disabled: !current },
      ),
    ),
  );
  const banner = el(
    "div",
    { class: "city-banner" },
    el("img", {
      src: `${import.meta.env.BASE_URL}assets/nyc.jpg`,
      alt: "New York City skyline",
    }),
    el("span", {}, "New York City / 2019 benchmark"),
  );
  main.replaceChildren(heading, banner, tabs, panel);
}
async function initialize() {
  submit.disabled = true;
  badge.textContent = "Model loading";
  try {
    engine = await PriceEngine.load();
    badge.textContent = "Verified ONNX / browser";
    submit.disabled = false;
    await predict(defaults);
  } catch (error) {
    engine = undefined;
    badge.textContent = "Model unavailable";
    main.replaceChildren(
      el("h1", {}, "Model unavailable"),
      el("p", {}, "The model could not be loaded or verified."),
      button("Retry model loading", RefreshCw, () => {
        void initialize();
      }),
    );
    announce(
      error instanceof Error ? error.message : "Model load failed.",
      true,
    );
  }
}
document
  .querySelector<HTMLDivElement>("#app")!
  .replaceChildren(
    el(
      "header",
      { class: "topbar" },
      el(
        "a",
        { class: "brand", href: import.meta.env.BASE_URL },
        createElement(Building2),
        el("strong", {}, "Airbnb Price Workbench"),
      ),
      badge,
    ),
    el("div", { class: "app-layout" }, sidebar, main),
    status,
    el(
      "footer",
      {},
      safeLink("Original code / MIT", SOURCE),
      el(
        "span",
        {},
        "Independent educational project. Not affiliated with Airbnb.",
      ),
      el(
        "a",
        { href: `${import.meta.env.BASE_URL}licenses.json` },
        "Licenses & photo credits",
      ),
    ),
  );
fillForm(defaults);
void initialize();
