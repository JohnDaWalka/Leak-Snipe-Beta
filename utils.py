"""
Utility functions for Poker Hand Tracker.
Handles path operations, font styling, and color utilities (legacy compatibility).
"""

import os
import sys
from typing import Optional

# Legacy re-exports for compatibility with poker_gui.py
from themes import lighten as _lighten, darken as _darken, blend as _blend


def font_style(*styles: str) -> str:
    """Return a tkinter-compatible font style string."""
    return " ".join(style for style in styles if style)


def canonical_path(path: str) -> str:
    """Normalize a file path to canonical form."""
    return os.path.normpath(os.path.abspath(path))


def normalize_path(path: str) -> str:
    """Normalize a file path."""
    return os.path.normpath(path)
