import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

from airbnb_price.contracts import BOROUGHS, NUMERIC, ROOM_TYPES


def load_frame(path):
    path = Path(path)
    if path.stat().st_size > 20_000_000:
        raise ValueError("CSV exceeds 20 MB.")
    required = ["id", "host_id", "neighbourhood_group", "room_type", "price", *NUMERIC]
    frame = pd.read_csv(path, usecols=required, nrows=100001)
    if len(frame) > 100000 or frame.empty:
        raise ValueError("CSV must contain 1-100,000 rows.")
    if frame["id"].isna().any() or frame["id"].duplicated().any() or frame["host_id"].isna().any():
        raise ValueError("Unique listing IDs and non-missing host groups are required.")
    for name in ["price", *NUMERIC]:
        frame[name] = pd.to_numeric(frame[name], errors="coerce")
    frame.loc[frame["number_of_reviews"].eq(0) & frame["reviews_per_month"].isna(), "reviews_per_month"] = 0
    limits = {
        "price": (5, 1000),
        "latitude": (40.49, 40.92),
        "longitude": (-74.26, -73.70),
        "minimum_nights": (1, 30),
        "number_of_reviews": (0, 700),
        "reviews_per_month": (0, 60),
        "availability_365": (0, 365),
    }
    mask = frame["neighbourhood_group"].isin(BOROUGHS) & frame["room_type"].isin(ROOM_TYPES)
    for name, (lower, upper) in limits.items():
        mask &= frame[name].between(lower, upper) & np.isfinite(frame[name])
    for name in ("minimum_nights", "number_of_reviews", "availability_365"):
        mask &= frame[name].mod(1).eq(0)
    cleaned = frame.loc[mask].copy().reset_index(drop=True)
    if len(cleaned) < 100:
        raise ValueError("Fewer than 100 eligible rows after fixed scope/quality filters.")
    return cleaned, {
        "source_rows": len(frame),
        "eligible_rows": len(cleaned),
        "excluded_rows": len(frame) - len(cleaned),
        "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
    }


def encode_frame(frame):
    columns = [frame["neighbourhood_group"].eq(value).to_numpy() for value in BOROUGHS]
    columns += [frame["room_type"].eq(value).to_numpy() for value in ROOM_TYPES]
    columns += [frame[name].to_numpy() for name in NUMERIC]
    return np.column_stack(columns).astype(np.float32)


def grouped_partitions(frame, seed=42):
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=seed)
    development, test = next(splitter.split(frame, groups=frame["host_id"]))
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.15 / 0.85, random_state=seed + 1)
    fitting, calibration = next(
        splitter.split(frame.iloc[development], groups=frame.iloc[development]["host_id"])
    )
    fitting, calibration = development[fitting], development[calibration]
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.15 / 0.70, random_state=seed + 2)
    train, selection = next(splitter.split(frame.iloc[fitting], groups=frame.iloc[fitting]["host_id"]))
    partitions = {
        "train": fitting[train],
        "selection": fitting[selection],
        "calibration": calibration,
        "test": test,
    }
    groups = {name: set(frame.iloc[indices]["host_id"]) for name, indices in partitions.items()}
    for name, values in groups.items():
        for other, other_values in groups.items():
            if name != other and values.intersection(other_values):
                raise ValueError("Host leakage between partitions.")
    return partitions
