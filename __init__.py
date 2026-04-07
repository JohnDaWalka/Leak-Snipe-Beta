"""
Poker Hand Tracker — Multi-site poker hand tracking with AI analysis.

This package provides:
- models: Hand and HandDatabase for data storage
- parsers: HandParser for parsing hand histories from multiple sites
- analysis: LeakEngine and SummaryGenerator for poker analytics
- importing: HandImporter and DriveHUD2Sync for hand import/sync
- themes: Color themes and utilities
- utils: Utility functions and helpers
"""

__version__ = "1.0.0"

# Re-export main classes for convenience
from models import Hand, HandDatabase
from parsers import HandParser
from analysis import LeakEngine, SummaryGenerator
from importing import HandImporter, DriveHUD2Sync
from themes import THEMES, lighten, darken, blend
from utils import font_style, canonical_path, normalize_path

__all__ = [
    "Hand",
    "HandDatabase",
    "HandParser",
    "LeakEngine",
    "SummaryGenerator",
    "HandImporter",
    "DriveHUD2Sync",
    "THEMES",
    "lighten",
    "darken",
    "blend",
    "font_style",
    "canonical_path",
    "normalize_path",
]
