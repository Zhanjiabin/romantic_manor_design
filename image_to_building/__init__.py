"""CPU image-to-building pipeline.

P0/P1 expose catalog, foot, and full-frame asset reconstruction only.
P2 adds a Pillow renderer matching ``BuildingPreview.renderPaper``.
Screenshot matching belongs to later gates and must not invent default walls.
"""

from .schema import FOOT_MODEL_VERSION, RENDERER_VERSION, SCHEMA_VERSION

__all__ = ["FOOT_MODEL_VERSION", "RENDERER_VERSION", "SCHEMA_VERSION"]
