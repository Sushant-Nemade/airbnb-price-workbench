import hashlib
import io
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def fetch_dataset(destination):
    metadata = json.loads(Path(__file__).with_name("dataset.json").read_text(encoding="utf-8"))
    destination = Path(destination)
    if destination.exists():
        if hashlib.file_digest(destination.open("rb"), "sha256").hexdigest() == metadata["sha256"]:
            print("Existing dataset matches the reviewed checksum.")
            return destination
        raise ValueError("Existing CSV differs from the reviewed dataset; it was not overwritten.")
    request = urllib.request.Request(
        metadata["download"], headers={"User-Agent": "AirbnbPriceWorkbench/0.1.0"}
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read(25_000_001)
    if len(payload) > 25_000_000:
        raise ValueError("Dataset download exceeds 25 MB.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        member = archive.getinfo(metadata["csv"])
        if member.file_size > 20_000_000:
            raise ValueError("Dataset CSV exceeds 20 MB.")
        with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
            extracted = Path(temporary) / "reviewed.csv"
            with archive.open(member) as source, extracted.open("wb") as target:
                shutil.copyfileobj(source, target)
            digest = hashlib.file_digest(extracted.open("rb"), "sha256").hexdigest()
            if digest != metadata["sha256"]:
                raise ValueError("Downloaded dataset checksum differs from the reviewed version.")
            if destination.exists():
                raise ValueError("Destination appeared during download; it was not overwritten.")
            extracted.replace(destination)
    print(f"Verified version-3 dataset: {digest}")
    return destination
