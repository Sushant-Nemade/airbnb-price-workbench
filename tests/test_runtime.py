import json
import shutil

import pytest
from fastapi.testclient import TestClient

from airbnb_price.contracts import Listing
from airbnb_price.runtime import ARTIFACTS, PriceModel
from airbnb_price.web import create_app


def test_saved_model_parity_and_measured_gate():
    model = PriceModel()
    probes = json.loads((ARTIFACTS / "parity.json").read_text())
    assert len(probes) == 30
    for probe in probes:
        result = model.predict(Listing(**probe["input"]))
        assert result["price_usd"] == pytest.approx(probe["expected_price"], abs=0.02)
        assert 5 <= result["lower_usd"] <= result["price_usd"] <= result["upper_usd"] <= 1000
    report = model.report
    assert (
        report["evaluation"]["test"]["mae_usd"]
        < report["evaluation"]["baselines"]["borough_room_median"]["mae_usd"]
    )
    assert 0.85 <= report["evaluation"]["interval_coverage"] <= 0.98
    assert sum(split["rows"] for split in report["splits"].values()) == report["dataset"]["eligible_rows"]


def test_tampered_model_rejected(tmp_path):
    shutil.copy(ARTIFACTS / "report.json", tmp_path)
    (tmp_path / "price-model.onnx").write_bytes(b"not-the-verified-model")
    with pytest.raises(ValueError, match="checksum"):
        PriceModel(tmp_path)


def test_actual_api_bounds_and_no_storage():
    with TestClient(create_app()) as client:
        response = client.post("/api/predict", json=Listing().model_dump())
        assert response.status_code == 200
        assert response.json()["year"] == 2019
        assert response.headers["cache-control"] == "no-store"
        assert client.post("/api/predict", json={"price": 3}).status_code == 422
        assert client.post("/api/predict", content=b"x" * 9000).status_code == 413
        assert client.get("/.env").status_code == 404
        assert client.get("/data/raw/AB_NYC_2019.csv").status_code == 404
        assert client.get("/health").json()["model_sha256"]
