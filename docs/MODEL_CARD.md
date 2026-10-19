# Model Card

Review: 2026-10-20. Independent educational NYC2019 listing-price benchmark.
Source of truth: src/airbnb_price/artifacts/report.json and its model SHA-256.

## Data and Target

Dgomonov/Kaggle NYC2019 Open Data version3, credited by publisher to Inside Airbnb.
Publisher license metadata: CC0 Public Domain. CSV SHA-256:
e420db40ff10fcb40efc1b5b1648ee0b18a48f4e4537155cecc59fe95d18783a .
Source48,895 rows; eligible47,924; excluded971. Fixed filters require supported
borough/room categories, NYC coordinate bounds, positive5-1000 USD price,
minimum nights1-30, bounded finite review/availability fields and unique listing
IDs. Missing reviews/month is set to0 only when review count is0; other invalid
rows are excluded. Filtered coverage is narrower than all NYC listings.

Target is advertised nightly USD price in the2019 snapshot, not paid bookings,
occupancy, current price or revenue. Host IDs group splits only; listing IDs
support uniqueness/membership hashes. Neither is a feature. Names, descriptions,
neighborhood labels and last-review dates are unused; raw records are not served.

## Training and Selection

Five borough + three room one-hot values and six numeric features make14 inputs.
Scaling is fit only on the training partition; log1p(price) is the target.
Candidates: ridge(alpha20) and MLP(48,24), fixed seed42, early stopping inside
the training partition, at most180 iterations. No convergence warning was emitted.

| Partition | Listings | Distinct hosts |
| --- | --- | --- |
| Train | 26,650 | 20,232 |
| Selection | 6,877 | 5,518 |
| Calibration | 7,305 | 5,518 |
| Test | 7,092 | 5,518 |

Host groups do not cross partitions; listing IDs are unique. Selection MAE:
ridge50.91, neural47.78 USD. Neural was selected before evaluating test results;
the selected model was not refit on selection/calibration/test. The final test
is an unseen-host listing split, not independent future/geographic evidence.

## Final Test and Uncertainty

MAE48.80 USD, RMSE90.71, R-squared0.3566, median absolute error26.07.
Global training-median baseline MAE69.51; training borough/room-median MAE52.66.
The learned model improves MAE, but substantial individual errors remain.
Borough/room segment errors, counts and interval coverage are in the report/UI.

The90% target band uses a finite-sample higher quantile of absolute residuals on
7,305 calibration listings. Radius111.35 USD; observed test coverage90.81%; mean
clipped width201.81 USD. Price predictions and interval ends are clipped5-1000 USD.
Repeated listings within hosts are dependent: standard exchangeable-example
conformal guarantees must NOT be assumed. Neither individual, segment-conditional,
future-time nor distribution-shift coverage is established. Measured historical
coverage is evidence, not a guaranteed current-price range.

## Export, Integrity and Privacy

ONNX uses standard operators, input float32[batch,14], including the fitted scaler.
Python CPU inference matches sklearn on the held-out set within0.000367 USD.
Thirty authored borough/room/review scenarios, not real listing rows, check
browser WASM parity against sklearn within0.03 USD on both viewports.
Python/browser verify the model SHA-256 before inference and reject invalid or
oversized artifacts. JSON/ONNX are used, never arbitrary pickle deserialization.

Browser inputs and batch CSVs are not sent to an inference server. Saved inputs
use localStorage, which is unencrypted and origin-specific. Models can retain
statistical information about public training data; no differential privacy or
complete non-memorization claim is made. No paid provider or Airbnb API is used.

## Appropriate Use

Demonstrate a reproducible ML pipeline, evaluation and local browser inference.
Do not treat this as current/seasonal pricing, a booking engine, legal/zoning
eligibility, housing/lending decision, causal analysis or income guarantee.
Amenities/bedrooms/property quality, fees, seasonality, policy changes and recent
market conditions are absent. Borough and coordinates must describe the same
location; numeric bounds do not verify an address or compliance.