import hashlib
import json
import math
import platform
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import sklearn
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

from airbnb_price.contracts import BOROUGHS, FEATURE_NAMES, Listing, ROOM_TYPES, vector
from airbnb_price.data import encode_frame, grouped_partitions, load_frame


DATASET = Path(__file__).with_name("dataset.json")


def restore_prices(values):
    return np.clip(np.expm1(np.clip(np.asarray(values).reshape(-1), -10, 12)), 5, 1000)


def metrics(actual, predicted):
    return {
        "mae_usd": float(mean_absolute_error(actual, predicted)),
        "rmse_usd": float(math.sqrt(mean_squared_error(actual, predicted))),
        "r2": float(r2_score(actual, predicted)),
        "median_absolute_error_usd": float(np.median(np.abs(actual - predicted))),
    }


def train(csv_path, output_directory):
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    frame, receipt = load_frame(csv_path)
    if receipt["sha256"] != dataset["sha256"]:
        raise ValueError("Dataset checksum differs from the reviewed version-3 source.")
    partitions = grouped_partitions(frame)
    features = encode_frame(frame)
    prices = frame["price"].to_numpy(dtype=np.float64)
    training, selection = partitions["train"], partitions["selection"]
    candidates = {
        "ridge_log": make_pipeline(StandardScaler(), Ridge(alpha=20)),
        "neural_log": make_pipeline(
            StandardScaler(),
            MLPRegressor(
                hidden_layer_sizes=(48, 24),
                max_iter=180,
                early_stopping=True,
                n_iter_no_change=15,
                random_state=42,
                batch_size=256,
            ),
        ),
    }
    selection_scores, fit_warnings = {}, {}
    for name, model in candidates.items():
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always", ConvergenceWarning)
            model.fit(features[training], np.log1p(prices[training]).astype(np.float32))
        fit_warnings[name] = [str(warning.message) for warning in captured]
        selection_scores[name] = metrics(
            prices[selection], restore_prices(model.predict(features[selection]))
        )
    chosen = min(selection_scores, key=lambda name: selection_scores[name]["mae_usd"])
    model = candidates[chosen]
    calibration, testing = partitions["calibration"], partitions["test"]
    calibration_prediction = restore_prices(model.predict(features[calibration]))
    residuals = np.abs(prices[calibration] - calibration_prediction)
    rank = min(len(residuals), math.ceil((len(residuals) + 1) * 0.90))
    radius = float(np.sort(residuals)[rank - 1])
    prediction = restore_prices(model.predict(features[testing]))
    lower, upper = np.maximum(5, prediction - radius), np.minimum(1000, prediction + radius)
    global_median = float(np.median(prices[training]))
    group_medians = frame.iloc[training].groupby(["neighbourhood_group", "room_type"])["price"].median()
    grouped = np.array(
        [
            group_medians.get((row.neighbourhood_group, row.room_type), global_median)
            for row in frame.iloc[testing].itertuples()
        ]
    )
    exported = convert_sklearn(
        model,
        initial_types=[("features", FloatTensorType([None, len(FEATURE_NAMES)]))],
        target_opset=18,
        black_op={"Scaler", "LinearRegressor"},
    )
    onnx.checker.check_model(exported)
    if any(node.domain not in ("", "ai.onnx") for node in exported.graph.node):
        raise ValueError("Model needs unsupported non-standard browser operators.")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(
        exported.SerializeToString(), sess_options=options, providers=["CPUExecutionProvider"]
    )
    onnx_prediction = restore_prices(session.run(None, {"features": features[testing]})[0])
    parity_error = float(np.max(np.abs(prediction - onnx_prediction)))
    if parity_error > 0.10:
        raise ValueError("ONNX and sklearn disagree by more than ten cents.")
    slices = []
    for column in ("neighbourhood_group", "room_type"):
        for value in sorted(frame[column].unique()):
            mask = frame.iloc[testing][column].eq(value).to_numpy()
            if mask.sum():
                slices.append(
                    {
                        "feature": column,
                        "value": value,
                        "rows": int(mask.sum()),
                        **metrics(prices[testing][mask], prediction[mask]),
                        "interval_coverage": float(
                            np.mean(
                                (prices[testing][mask] >= lower[mask])
                                & (prices[testing][mask] <= upper[mask])
                            )
                        ),
                    }
                )
    result = {
        "schema_version": 1,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {**dataset, **receipt},
        "feature_names": FEATURE_NAMES,
        "model": chosen,
        "evaluation": {
            "selection": selection_scores,
            "test": metrics(prices[testing], prediction),
            "baselines": {
                "global_median": metrics(prices[testing], np.full(len(testing), global_median)),
                "borough_room_median": metrics(prices[testing], grouped),
            },
            "interval_coverage": float(np.mean((prices[testing] >= lower) & (prices[testing] <= upper))),
            "mean_interval_width_usd": float(np.mean(upper - lower)),
            "slices": slices,
            "onnx_sklearn_max_error_usd": parity_error,
        },
        "splits": {
            name: {
                "rows": len(indices),
                "hosts": int(frame.iloc[indices].host_id.nunique()),
                "membership_sha256": hashlib.sha256(
                    ",".join(map(str, sorted(frame.iloc[indices].id.tolist()))).encode()
                ).hexdigest(),
            }
            for name, indices in partitions.items()
        },
        "interval": {
            "target_coverage": 0.90,
            "absolute_residual_radius_usd": radius,
            "method": "split conformal; host-disjoint calibration; finite-sample higher quantile",
            "limitations": "Marginal historical coverage only; repeated listings within hosts are dependent. No group-conditional, temporal or current-market guarantee.",
        },
        "scope": {
            "year": 2019,
            "city": "New York City",
            "currency": "USD",
            "price_min": 5,
            "price_max": 1000,
            "minimum_nights_max": 30,
            "target": "Advertised nightly listing price, not paid booking revenue",
            "clipping": "Predictions and intervals clipped to declared 5-1000 USD filtered scope",
        },
        "libraries": {
            "python": platform.python_version(),
            "sklearn": sklearn.__version__,
            "numpy": np.__version__,
            "onnxruntime": ort.__version__,
        },
        "training_warnings": fit_warnings,
        "limitations": [
            "Historical 2019 snapshot; not a live Airbnb quote or current pricing recommendation.",
            "Evaluation is host-disjoint, not a temporal or geographic holdout.",
            "Only eligible NYC listings priced 5-1000 USD with minimum stays up to 30 nights were modeled.",
            "Excludes taxes, cleaning/service fees, availability verification and booking transactions.",
            "Host/listing identifiers, names and review timestamps are not prediction features or served records.",
            "Coordinates and borough must refer to the same location; bounds alone do not verify address or zoning.",
            "The uncertainty band is calibrated on historical residuals, not a guaranteed individual price range.",
        ],
    }
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    model_bytes = exported.SerializeToString()
    (output / "price-model.onnx").write_bytes(model_bytes)
    result["model_sha256"] = hashlib.sha256(model_bytes).hexdigest()
    probes = []
    centers = [(40.85, -73.87), (40.695, -73.98), (40.76, -73.98), (40.73, -73.82), (40.58, -74.15)]
    for borough, (latitude, longitude) in zip(BOROUGHS, centers, strict=True):
        for room_type in ROOM_TYPES:
            for reviews in (0, 42):
                listing = Listing(
                    borough=borough,
                    room_type=room_type,
                    latitude=latitude,
                    longitude=longitude,
                    minimum_nights=3,
                    number_of_reviews=reviews,
                    reviews_per_month=0.0 if reviews == 0 else 1.5,
                    availability_365=180,
                )
                values = np.asarray([vector(listing)], dtype=np.float32)
                probes.append(
                    {
                        "input": listing.model_dump(),
                        "expected_price": float(restore_prices(model.predict(values))[0]),
                    }
                )
    (output / "parity.json").write_text(
        json.dumps(probes, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    (output / "report.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "chosen": chosen,
                "rows": receipt,
                "test": result["evaluation"]["test"],
                "baselines": result["evaluation"]["baselines"],
                "coverage": result["evaluation"]["interval_coverage"],
                "onnx_max_error": parity_error,
            },
            indent=2,
        )
    )
    return result
