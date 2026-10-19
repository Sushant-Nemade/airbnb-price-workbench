# Operations

## Public Browser Deployment

Deploy frontend/dist after npm ci --ignore-scripts and npm run build. The postbuild
copies the reviewed ONNX model, report, authored parity inputs and all bundled
notices. The public site needs only static HTTPS hosting. GitHub Pages supports
the repository subpath; Vite uses relative asset URLs. No local PC, tunnel,
database, secret or paid inference endpoint is required.

Model and WebAssembly bytes are intentionally public. The browser downloads a
roughly14 MB self-hosted runtime on first load, verifies the model SHA-256, and
runs single-thread WASM without SharedArrayBuffer/cross-origin isolation. No CDN,
analytics or external font/photo requests are needed during use.

Only the public folder and reviewed model/report are copied. Never deploy raw
training CSV, data/, .env, a private workspace or an arbitrary trained artifact.
The site's JSON report records known model/data limitations, not secret credentials.

## Python Service

airbnb-prices serve binds127.0.0.1:8896. For a selected remote deployment, use a
proper process supervisor/reverse proxy, HTTPS, access policy, body/connection
timeouts, external rate limiting and operational monitoring. The built-in60/min
admission limit is per process, not a distributed abuse-control service. Do not
claim production operation merely because the sample container starts.

The API is stateless, accepts only bounded listing features and retains no
predictions. Server access logs may still contain IPs/request paths; configure
logging/retention appropriately. It supports no accounts, uploads, arbitrary
model URLs, remote training, paid calls or private owner history. Browser static
inference is the primary public route; exposing this API is optional separate scope.

## Model Updates and Rollback

1. Review intended data rights/source/version and scope. Do not silently replace
   the2019 benchmark with new data or weaken its checksum gate.
2. Train with fixed splits/seed/locked dependencies. Inspect baselines, selection,
   held-out errors, calibration width/coverage, segment errors and warning logs.
   Numeric reproducibility is tolerance-based, not bit-for-bit across platforms.
3. Review new ONNX/report together and the30 authored parity scenarios. Browser
   and Python outputs must agree; failed integrity checks must disable inference.
4. Rebuild the UI, verify images/notices/model bytes, run desktop/mobile acceptance,
   audits and installed-wheel/source checks; then deploy that exact reviewed source.
5. Retain the prior release/model/report/public build for rollback. Static-host
   rollback must restore matching model/report/assets, not only index.html.

Saved browser scenarios are input-only and origin-specific. Reopening uses the
current model; exports contain the model hash and year. Users can delete saved
scenarios or clear site storage; external downloads/backups are not deleted by that.

## Licensing and Maintenance

Original code/model MIT; dataset publisher metadata CC0; photo/crop CC BY-SA3.0;
Manrope OFL and JavaScript/WASM dependencies retain separate notices. Official
ONNX Runtime1.30.0 LICENSE/ThirdPartyNotices are retained under frontend/legal
because its npm package omits them. The build records actual emitted package
identities; GUID/WebGL-only installed dependencies are not shipped by the WASM path.
Updating runtime versions requires reviewing its notices, not an automatic fallback
to another version's license file. Dependency scans are dated, not a permanent
security guarantee. No SLA, current-market certification or unattended retraining
is enabled.