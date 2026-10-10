"""
Geospatial and H3 Hexagonal Indexing Utility.
Provides seamless cross-version compatibility between H3 v3 and v4 APIs.
"""
from typing import Set, List
import h3


def geo_to_h3(lat: float, lng: float, resolution: int = 12) -> str:
    """
    Snap latitude/longitude coordinates to an H3 hexagon index string.
    Resolution 12 corresponds to ~9.4 meter edge length.
    """
    if hasattr(h3, "latlng_to_cell"):
        return h3.latlng_to_cell(lat, lng, resolution)
    elif hasattr(h3, "geo_to_h3"):
        return h3.geo_to_h3(lat, lng, resolution)
    raise AttributeError("Incompatible H3 library version installed.")


def k_ring(hex_id: str, k: int = 1) -> Set[str]:
    """
    Retrieve surrounding neighbor hexagon cells within distance k.
    """
    if hasattr(h3, "grid_disk"):
        return set(h3.grid_disk(hex_id, k))
    elif hasattr(h3, "k_ring"):
        return set(h3.k_ring(hex_id, k))
    raise AttributeError("Incompatible H3 library version installed.")


def h3_to_geo(hex_id: str) -> tuple[float, float]:
    """
    Retrieve centroid latitude/longitude from an H3 cell index.
    """
    if hasattr(h3, "cell_to_latlng"):
        return h3.cell_to_latlng(hex_id)
    elif hasattr(h3, "h3_to_geo"):
        return h3.h3_to_geo(hex_id)
    raise AttributeError("Incompatible H3 library version installed.")
