import hashlib
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import onnxruntime as ort

from airbnb_price.contracts import Listing, vector


ARTIFACTS = Path(__file__).with_name("artifacts")


class PriceModel:
    def __init__(self, directory=ARTIFACTS):
        directory = Path(directory)
        report_path = directory / "report.json"
        model_path = directory / "price-model.onnx"
        if report_path.stat().st_size > 150000 or model_path.stat().st_size > 2_000_000:
            raise ValueError("Model artifact exceeds declared limits.")
        self.report = json.loads(report_path.read_text(encoding="utf-8"))
        payload = model_path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != self.report["model_sha256"]:
            raise ValueError("Model checksum verification failed.")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(payload, sess_options=options, providers=["CPUExecutionProvider"])

    def predict(self, listing: Listing):
        values = np.asarray([vector(listing)], dtype=np.float32)
        output = float(self.session.run(None, {"features": values})[0].reshape(-1)[0])
        if not np.isfinite(output):
            raise ValueError("The model produced an invalid value.")
        price = float(np.clip(np.expm1(np.clip(output, -10, 12)), 5, 1000))
        radius = self.report["interval"]["absolute_residual_radius_usd"]
        return {
            "price_usd": round(price, 2),
            "lower_usd": round(max(5, price - radius), 2),
            "upper_usd": round(min(1000, price + radius), 2),
            "target_coverage": 0.9,
            "year": 2019,
            "currency": "USD",
            "model_sha256": self.report["model_sha256"],
            "label": "Historical NYC 2019 benchmark estimate; not a current rental quote",
            "input": listing.model_dump(),
        }


@lru_cache(maxsize=1)
def get_model():
    return PriceModel()
