import shutil
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "frontend/dist"
    for name in (
        "index.html",
        "price-model.onnx",
        "report.json",
        "parity.json",
        "LICENSE",
        "NOTICE.md",
        "licenses.json",
        "assets/nyc.jpg",
    ):
        if not (source / name).is_file():
            raise ValueError(f"Build the complete site before packaging: missing {name}")
    target = root / "src/airbnb_price/site"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    print("Bundled the complete verified site into the Python package.")


if __name__ == "__main__":
    main()
