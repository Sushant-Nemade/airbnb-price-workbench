from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


BOROUGHS = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"]
ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room"]
NUMERIC = [
    "latitude",
    "longitude",
    "minimum_nights",
    "number_of_reviews",
    "reviews_per_month",
    "availability_365",
]
FEATURE_NAMES = (
    ["borough:" + value for value in BOROUGHS] + ["room:" + value for value in ROOM_TYPES] + NUMERIC
)


class Listing(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    borough: Literal["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"] = "Brooklyn"
    room_type: Literal["Entire home/apt", "Private room", "Shared room"] = "Entire home/apt"
    latitude: float = Field(default=40.695, ge=40.49, le=40.92, strict=True)
    longitude: float = Field(default=-73.98, ge=-74.26, le=-73.70, strict=True)
    minimum_nights: int = Field(default=3, ge=1, le=30, strict=True)
    number_of_reviews: int = Field(default=25, ge=0, le=700, strict=True)
    reviews_per_month: float = Field(default=1.2, ge=0, le=60, strict=True)
    availability_365: int = Field(default=180, ge=0, le=365, strict=True)


def vector(listing: Listing) -> list[float]:
    return (
        [float(listing.borough == value) for value in BOROUGHS]
        + [float(listing.room_type == value) for value in ROOM_TYPES]
        + [float(getattr(listing, name)) for name in NUMERIC]
    )
