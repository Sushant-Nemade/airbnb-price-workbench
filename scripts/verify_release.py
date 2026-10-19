import os
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipfile
from pathlib import Path


def main():
    metadata = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))["project"]
    stem = metadata["name"].replace("-", "_") + "-" + metadata["version"]
    wheels = list(Path("dist").glob(stem + "-*.whl"))
    assert len(wheels) == 1
    wheel = wheels[0]
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        for name in (
            "airbnb_price/runtime.py",
            "airbnb_price/site/index.html",
            "airbnb_price/site/licenses.json",
            "airbnb_price/dataset.json",
        ):
            assert name in names, name
        assert archive.read("airbnb_price/artifacts/price-model.onnx") == archive.read(
            "airbnb_price/site/price-model.onnx"
        )
        expected = {
            path.relative_to("frontend/dist").as_posix()
            for path in Path("frontend/dist").rglob("*")
            if path.is_file()
        }
        actual = {
            name.removeprefix("airbnb_price/site/") for name in names if name.startswith("airbnb_price/site/")
        }
        assert expected == actual, "Missing or stale installed UI assets."
        assert not any(
            "AB_NYC_2019.csv" in name or name.endswith((".pkl", ".pickle", ".pem", "/.env")) for name in names
        )
    with tarfile.open(Path("dist") / (stem + ".tar.gz")) as archive:
        names = archive.getnames()
        for suffix in (
            "frontend/package-lock.json",
            "frontend/src/engine.ts",
            "frontend/legal/onnxruntime-ThirdPartyNotices.txt",
            "tests/test_runtime.py",
            "uv.lock",
            "NOTICE.md",
        ):
            assert any(name.endswith("/" + suffix) for name in names), suffix
        assert not any(
            "/node_modules/" in name or "AB_NYC_2019.csv" in name or name.endswith((".pkl", ".pem", "/.env"))
            for name in names
        )
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "installed"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-deps",
                "--target",
                str(target),
                str(wheel.resolve()),
            ],
            check=True,
        )
        environment = {**os.environ, "PYTHONPATH": str(target)}
        code = "from pathlib import Path; import airbnb_price; assert 'installed' in str(Path(airbnb_price.__file__)); from airbnb_price.runtime import get_model; from airbnb_price.contracts import Listing; assert get_model().predict(Listing())['year']==2019; from fastapi.testclient import TestClient; from airbnb_price.web import create_app; connection=TestClient(create_app()); connection.__enter__(); assert connection.get('/').status_code==200; assert connection.get('/price-model.onnx').status_code==200; assert connection.get('/data/raw/AB_NYC_2019.csv').status_code==404; connection.__exit__(None,None,None); print('Installed model/UI/API verified outside checkout')"
        subprocess.run([sys.executable, "-c", code], cwd=directory, env=environment, check=True)
    print("Current-version wheel/source completeness, model integrity and private-data exclusions passed.")


if __name__ == "__main__":
    main()
