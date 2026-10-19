import * as ort from "onnxruntime-web/wasm";
import { z } from "zod";

export const boroughs = [
  "Bronx",
  "Brooklyn",
  "Manhattan",
  "Queens",
  "Staten Island",
] as const;
export const rooms = [
  "Entire home/apt",
  "Private room",
  "Shared room",
] as const;
export const numeric = [
  "latitude",
  "longitude",
  "minimum_nights",
  "number_of_reviews",
  "reviews_per_month",
  "availability_365",
] as const;
export const listingSchema = z
  .object({
    borough: z.enum(boroughs),
    room_type: z.enum(rooms),
    latitude: z.number().finite().min(40.49).max(40.92),
    longitude: z.number().finite().min(-74.26).max(-73.7),
    minimum_nights: z.number().int().min(1).max(30),
    number_of_reviews: z.number().int().min(0).max(700),
    reviews_per_month: z.number().finite().min(0).max(60),
    availability_365: z.number().int().min(0).max(365),
  })
  .strict();
export type Listing = z.infer<typeof listingSchema>;
const metricSchema = z.object({
  mae_usd: z.number().finite(),
  rmse_usd: z.number().finite(),
  r2: z.number().finite(),
  median_absolute_error_usd: z.number().finite(),
});
export const reportSchema = z
  .object({
    schema_version: z.literal(1),
    model: z.string().max(80),
    model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    trained_at: z.string(),
    dataset: z
      .object({
        source: z.url(),
        license: z.string(),
        snapshot_year: z.literal(2019),
        source_rows: z.number().int(),
        eligible_rows: z.number().int(),
        excluded_rows: z.number().int(),
        sha256: z.string(),
      })
      .passthrough(),
    evaluation: z
      .object({
        test: metricSchema,
        baselines: z.object({
          global_median: metricSchema,
          borough_room_median: metricSchema,
        }),
        interval_coverage: z.number().min(0).max(1),
        mean_interval_width_usd: z.number().finite(),
        slices: z.array(
          z.object({
            feature: z.string(),
            value: z.string(),
            rows: z.number().int(),
            mae_usd: z.number().finite(),
            interval_coverage: z.number().min(0).max(1),
          }),
        ),
        onnx_sklearn_max_error_usd: z.number().finite(),
      })
      .passthrough(),
    interval: z
      .object({
        target_coverage: z.literal(0.9),
        absolute_residual_radius_usd: z.number().finite().positive(),
        limitations: z.string(),
      })
      .passthrough(),
    splits: z.record(
      z.string(),
      z.object({
        rows: z.number().int(),
        hosts: z.number().int(),
        membership_sha256: z.string(),
      }),
    ),
    feature_names: z.array(z.string()).length(14),
    limitations: z.array(z.string().max(700)).max(20),
  })
  .passthrough();
export type Report = z.infer<typeof reportSchema>;
export interface Estimate {
  price_usd: number;
  lower_usd: number;
  upper_usd: number;
  target_coverage: number;
  year: 2019;
  currency: "USD";
  model_sha256: string;
  input: Listing;
  label: string;
}
export const defaults: Listing = {
  borough: "Brooklyn",
  room_type: "Entire home/apt",
  latitude: 40.695,
  longitude: -73.98,
  minimum_nights: 3,
  number_of_reviews: 25,
  reviews_per_month: 1.2,
  availability_365: 180,
};
export const centers: Record<Listing["borough"], [number, number]> = {
  Bronx: [40.85, -73.87],
  Brooklyn: [40.695, -73.98],
  Manhattan: [40.76, -73.98],
  Queens: [40.73, -73.82],
  "Staten Island": [40.58, -74.15],
};

export function encode(listing: Listing): number[] {
  const input = listingSchema.parse(listing);
  return [
    ...boroughs.map((value) => Number(input.borough === value)),
    ...rooms.map((value) => Number(input.room_type === value)),
    ...numeric.map((name) => input[name]),
  ];
}

async function boundedAsset(name: string, limit: number): Promise<Uint8Array> {
  const response = await fetch(new URL(name, document.baseURI), {
    signal: AbortSignal.timeout(45000),
    cache: "no-cache",
  });
  if (!response.ok || !response.body)
    throw new Error(`Unable to load ${name}.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Model asset exceeds the safety limit.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export class PriceEngine {
  readonly report: Report;
  private readonly session: ort.InferenceSession;
  constructor(report: Report, session: ort.InferenceSession) {
    this.report = report;
    this.session = session;
  }
  static async load(): Promise<PriceEngine> {
    const report = reportSchema.parse(
      JSON.parse(
        new TextDecoder().decode(await boundedAsset("report.json", 150000)),
      ),
    );
    const bytes = await boundedAsset("price-model.onnx", 2000000);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
      ),
    )
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== report.model_sha256)
      throw new Error("Model checksum failed. Inference is disabled.");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    if (session.inputNames.length !== 1 || session.inputNames[0] !== "features")
      throw new Error("Unsupported model input contract.");
    return new PriceEngine(report, session);
  }
  async predict(inputs: Listing[]): Promise<Estimate[]> {
    if (inputs.length < 1 || inputs.length > 100)
      throw new Error("Predict between 1 and 100 scenarios.");
    const valid = inputs.map((value) => listingSchema.parse(value));
    const tensor = new ort.Tensor(
      "float32",
      Float32Array.from(valid.flatMap(encode)),
      [valid.length, 14],
    );
    const outputs = await this.session.run({ features: tensor });
    const result = outputs[this.session.outputNames[0]];
    try {
      const values = Array.from(result.data as Float32Array);
      if (
        values.length !== valid.length ||
        values.some((value) => !Number.isFinite(value))
      )
        throw new Error("Model output failed validation.");
      return values.map((value, index) => {
        const price = Math.min(
          1000,
          Math.max(5, Math.expm1(Math.min(12, Math.max(-10, value)))),
        );
        const radius = this.report.interval.absolute_residual_radius_usd;
        const round = (number: number) => Math.round(number * 100) / 100;
        return {
          price_usd: round(price),
          lower_usd: round(Math.max(5, price - radius)),
          upper_usd: round(Math.min(1000, price + radius)),
          target_coverage: 0.9,
          year: 2019,
          currency: "USD",
          model_sha256: this.report.model_sha256,
          input: valid[index],
          label:
            "Historical NYC 2019 benchmark estimate; not a current rental quote",
        };
      });
    } finally {
      tensor.dispose();
      for (const value of Object.values(outputs)) value.dispose();
    }
  }
}

export function parseListingRow(row: Record<string, string>): Listing {
  const values: Record<string, unknown> = {};
  if (Object.keys(row).length !== 8)
    throw new Error("CSV must contain exactly the eight input columns.");
  for (const [name, value] of Object.entries(row)) {
    if ((numeric as readonly string[]).includes(name)) {
      if (!value.trim()) throw new Error("Numeric fields cannot be empty.");
      values[name] = Number(value);
    } else values[name] = value.trim();
  }
  return listingSchema.parse(values);
}
