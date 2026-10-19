# Airbnb Price Workbench

An original, MIT-licensed historical NYC rental-price estimator with reproducible
training, held-out evaluation, calibrated uncertainty, a stateless Python API
and **real ONNX inference in the browser**. It is not a mock calculator, a live
Airbnb integration or a current rental-price recommendation.

## Public Demo

[Open the browser estimator](https://sushant-nemade.github.io/airbnb-price-workbench/).
The public static site runs the trained model locally in your browser, without
requiring the maintainer's computer, a hosted Python API or paid services.
First load downloads a self-hosted approximately14 MB WebAssembly runtime; inputs
and CSVs stay local. No current-market accuracy or uptime SLA is claimed.

## Measured Results

Pinned NYC2019 version3: 48,895 source rows, 47,924 eligible after fixed scope
filters. Four host-disjoint partitions keep model selection, calibration and
testing separate. No listing or host appears across those partitions.

| Final test metric | Result |
| --- | --- |
| Test listings / hosts | 7,092 / 5,518 |
| Model MAE | $48.80 |
| Borough/room median MAE | $52.66 |
| Global median MAE | $69.51 |
| Model RMSE / R-squared | $90.71 / 0.357 |
| Median absolute error | $26.07 |
| Historical interval coverage / target | 90.81% / 90% |
| Mean interval width | $201.81 |

The selected small neural model predicts log1p(price). Standard scaling is fit
only on training data. Ridge and neural candidates are selected using selection
MAE, never test scores. Predictions/intervals are clipped to the declared $5-$1,000
filtered scope. The report includes borough/room slices, source/model hashes,
split membership hashes and library versions. See [model card](docs/MODEL_CARD.md).

## Provenance and Rights

The concept was selected from [KalyanM45's AI Project Gallery](https://github.com/KalyanM45/AI-Project-Gallery).
Its [Airbnb reference repository](https://github.com/KalyanM45/End-to-End-Airbnb-Price-Prediction)
at `2b6dc21406cfe0a24d303d1db12505403abed52e` has no detected code license or
license file. **No upstream code, data, model, assets or history were imported.**
This original implementation is not an attributed fork or exact feature-parity claim.

The separate [Dgomonov NYC2019 dataset](https://www.kaggle.com/datasets/dgomonov/new-york-city-airbnb-open-data)
is labeled CC0 in its publisher metadata and credits Inside Airbnb. Version,
rights representation, source URL and exact CSV checksum are in
[dataset.json](src/airbnb_price/dataset.json). Raw rows, host/listing identifiers,
names and review timestamps are not served or redistributed. See [NOTICE.md](NOTICE.md)
for data caveats and the separate CC BY-SA photo/font/runtime licenses.

## Quick Start

Requires Python3.11+ (3.13 recommended), Node24 and uv. Commands run from the
repository root in PowerShell or a POSIX shell:

```sh
git clone https://github.com/Sushant-Nemade/airbnb-price-workbench.git
cd airbnb-price-workbench
uv sync --frozen
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend run build
uv run --frozen airbnb-prices serve
```

Open http://127.0.0.1:8896/ . The checked model/report are included; training,
Kaggle credentials, a database and provider keys are not required for inference.
Use the public demo to skip local setup. Local browser storage holds at most20
saved input scenarios; it is origin-specific, unencrypted and not a cloud backup.
Reload/reopen reruns the current verified model rather than trusting old saved prices.

The UI supports an individual estimate, calibrated band, measured model evidence,
saved/reopened/deleted scenarios, JSON export and local batch CSV. CSVs are limited
to1 MB/100 rows; malformed headers or invalid/out-of-scope rows fail visibly.
The downloadable template contains the eight supported fields; identifiers,
names, bedrooms/amenities and price are not accepted prediction inputs.

## Reproduce Training

```sh
uv run --frozen airbnb-prices fetch-data
uv run --frozen airbnb-prices train
npm --prefix frontend run build
uv run --frozen pytest -q
```

Dataset download uses a fixed public version and verified checksum; an existing
different CSV is not overwritten. No upstream pickle is loaded or distributed.
Training uses a deterministic seed and locked dependencies. Numeric training
reproducibility has tolerances across platforms; generated ONNX graph names and
timestamps are not promised byte-identical. Review/retest any new artifacts before
publication; the checked-in report/model define the published reference.

## API and Verification

Public local routes: GET /health, GET /api/model, POST /api/predict. Prediction
inputs use the same bounded contract as the browser; body limit8 KB, at most60
predictions/minute/process. No user accounts, database or prediction retention
are implemented. No wildcard CORS, arbitrary model upload or model-path parameter
is exposed. HTTPS/network access controls and operational policy are required
before using this Python service remotely; public browser inference needs none.

```sh
uv run --frozen pytest -q
uv run --frozen ruff check src tests scripts
node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.config.ts
npm --prefix frontend audit
uv run --frozen pip-audit
uv run --frozen python scripts/package_site.py
uv run --frozen python -m build
uv run --frozen twine check dist/*
uv run --frozen python scripts/verify_release.py
```

Browser tests start a fresh real API, execute actual WASM inference and compare
all30 authored scenarios with sklearn values within3 cents on desktop/mobile.
They also check model tampering/retry, CSV rows/export, browser saves, keyboard
tabs, real image/chart pixels and320px layouts. [Release evidence](docs/RELEASE_STATUS.md)
distinguishes local checks, remote CI, public deployment and remaining boundaries.

## Boundaries and Contributions

This2019 snapshot cannot establish future/current prices, market demand, causal
effects, revenue optimization, legal eligibility, current availability or booking
offers. Snapshot review/availability features are associations, not interventions.
Do not use the estimates for lending, housing eligibility or automated decisions
about people. No temporal, geographic-transfer or production certification exists.

Keep changes scoped; add behavior-specific tests and preserve license/data/model
provenance. Do not commit private inputs, raw training data, secrets or untrusted
models. Recheck dependency advisories and deployed assets when updating. See
[operations](docs/OPERATIONS.md) for installation, model integrity and rollback.