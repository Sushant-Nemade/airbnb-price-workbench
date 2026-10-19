import math

import pytest
from pydantic import ValidationError

from airbnb_price.contracts import FEATURE_NAMES, Listing, vector


def test_vector_order_and_no_identifiers():
    values = vector(Listing())
    assert len(values) == len(FEATURE_NAMES) == 14
    assert sum(values[:5]) == sum(values[5:8]) == 1
    assert all(math.isfinite(value) for value in values)
    assert not {"host_id", "id", "price", "host_name"}.intersection(FEATURE_NAMES)


@pytest.mark.parametrize(
    "fields",
    [
        {"minimum_nights": 0},
        {"minimum_nights": True},
        {"minimum_nights": 31},
        {"availability_365": 366},
        {"number_of_reviews": -1},
        {"reviews_per_month": float("nan")},
        {"latitude": 0.0},
        {"longitude": float("inf")},
        {"borough": "London"},
        {"room_type": "Hotel room"},
        {"price": 200},
        {"host_name": "not-needed"},
    ],
)
def test_invalid_listing_rejected(fields):
    with pytest.raises(ValidationError):
        Listing.model_validate(fields)
