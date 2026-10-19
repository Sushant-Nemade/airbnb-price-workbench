import numpy as np
import pandas as pd
import pytest

from airbnb_price.contracts import Listing, vector
from airbnb_price.data import encode_frame, grouped_partitions, load_frame


def fixture_frame():
    listing = Listing().model_dump()
    listing["neighbourhood_group"] = listing.pop("borough")
    return pd.DataFrame(
        [
            {**listing, "id": index + 1, "host_id": index // 3, "price": 120 + index % 50}
            for index in range(600)
        ]
    )


def test_host_groups_disjoint_and_reproducible():
    frame = fixture_frame()
    first, second = grouped_partitions(frame), grouped_partitions(frame)
    all_rows = np.concatenate(list(first.values()))
    assert sorted(all_rows) == list(range(len(frame)))
    assert all(np.array_equal(first[name], second[name]) for name in first)
    for name, indices in first.items():
        for other, other_indices in first.items():
            if name != other:
                assert not set(frame.iloc[indices].host_id).intersection(frame.iloc[other_indices].host_id)


def test_fixed_scope_filters_and_feature_parity(tmp_path):
    frame = fixture_frame()
    frame.loc[0, "price"] = 0
    frame.loc[1, "minimum_nights"] = 90
    frame.loc[2, "number_of_reviews"] = 0
    frame.loc[2, "reviews_per_month"] = np.nan
    path = tmp_path / "input.csv"
    frame.to_csv(path, index=False)
    clean, receipt = load_frame(path)
    assert receipt["excluded_rows"] == 2
    assert clean.iloc[0].reviews_per_month == 0
    assert encode_frame(clean).shape == (598, 14)
    assert encode_frame(clean)[1].tolist() == pytest.approx(vector(Listing()))
    frame.loc[1, "id"] = frame.loc[0, "id"]
    frame.to_csv(path, index=False)
    with pytest.raises(ValueError, match="Unique"):
        load_frame(path)
