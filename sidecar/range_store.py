import os
import sqlite3
import json
import uuid
import logging
from datetime import datetime
from threading import Lock
from typing import Dict, Any, List, Optional

class RangeStore:
    def __init__(self, db_path: str = "ranges.db"):
        self.db_path = db_path
        self.lock = Lock()
        self._init_db()

    def _connect(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self.lock:
            conn = self._connect()
            try:
                # Range folders table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS range_folders (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        parent_id TEXT,
                        sort_order INTEGER DEFAULT 0,
                        created_at TEXT
                    )
                """)
                # Custom ranges table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS ranges (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        folder_id TEXT,
                        position TEXT,
                        stack_depth INTEGER,
                        game_type TEXT,
                        grid_data TEXT NOT NULL,
                        color_palette TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                """)
                # Chart overrides table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS chart_overrides (
                        chart_id TEXT PRIMARY KEY,
                        grid_data TEXT NOT NULL,
                        color_palette TEXT,
                        updated_at TEXT
                    )
                """)
                conn.commit()
            except Exception as e:
                logging.error("Failed to initialize ranges database: %s", e)
            finally:
                conn.close()

    # --- Overrides API ---
    def get_override(self, chart_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT grid_data, color_palette, updated_at FROM chart_overrides WHERE chart_id = ?",
                    (chart_id,)
                ).fetchone()
                if row:
                    return {
                        "chart_id": chart_id,
                        "grid_data": json.loads(row[0]),
                        "color_palette": json.loads(row[1]) if row[1] else {},
                        "updated_at": row[2]
                    }
                return None
            finally:
                conn.close()

    def save_override(self, chart_id: str, grid_data: List[Any], color_palette: Dict[str, str]) -> None:
        with self.lock:
            conn = self._connect()
            try:
                grid_json = json.dumps(grid_data)
                palette_json = json.dumps(color_palette)
                now = datetime.now().isoformat()
                conn.execute(
                    """
                    INSERT INTO chart_overrides (chart_id, grid_data, color_palette, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(chart_id) DO UPDATE SET
                        grid_data = excluded.grid_data,
                        color_palette = excluded.color_palette,
                        updated_at = excluded.updated_at
                    """,
                    (chart_id, grid_json, palette_json, now)
                )
                conn.commit()
            finally:
                conn.close()

    def delete_override(self, chart_id: str) -> bool:
        with self.lock:
            conn = self._connect()
            try:
                cursor = conn.execute("DELETE FROM chart_overrides WHERE chart_id = ?", (chart_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    # --- Folders API ---
    def list_folders(self) -> List[Dict[str, Any]]:
        with self.lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT id, name, parent_id, sort_order, created_at FROM range_folders ORDER BY sort_order, name"
                ).fetchall()
                return [
                    {
                        "id": r[0],
                        "name": r[1],
                        "parent_id": r[2],
                        "sort_order": r[3],
                        "created_at": r[4]
                    } for r in rows
                ]
            finally:
                conn.close()

    def create_folder(self, name: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            conn = self._connect()
            try:
                folder_id = str(uuid.uuid4())
                now = datetime.now().isoformat()
                conn.execute(
                    "INSERT INTO range_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)",
                    (folder_id, name, parent_id, now)
                )
                conn.commit()
                return {"id": folder_id, "name": name, "parent_id": parent_id, "created_at": now}
            finally:
                conn.close()

    def rename_folder(self, folder_id: str, name: str) -> bool:
        with self.lock:
            conn = self._connect()
            try:
                cursor = conn.execute("UPDATE range_folders SET name = ? WHERE id = ?", (name, folder_id))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def delete_folder(self, folder_id: str) -> bool:
        with self.lock:
            conn = self._connect()
            try:
                # Dissociate ranges in this folder
                conn.execute("UPDATE ranges SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
                # Reparent children folders
                conn.execute("UPDATE range_folders SET parent_id = NULL WHERE parent_id = ?", (folder_id,))
                cursor = conn.execute("DELETE FROM range_folders WHERE id = ?", (folder_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    # --- Ranges API ---
    def list_ranges(self, folder_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.lock:
            conn = self._connect()
            try:
                if folder_id:
                    rows = conn.execute(
                        """SELECT id, name, folder_id, position, stack_depth, game_type, color_palette, created_at, updated_at
                           FROM ranges WHERE folder_id = ? ORDER BY name""",
                        (folder_id,)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """SELECT id, name, folder_id, position, stack_depth, game_type, color_palette, created_at, updated_at
                           FROM ranges ORDER BY name"""
                    ).fetchall()
                return [
                    {
                        "id": r[0],
                        "name": r[1],
                        "folder_id": r[2],
                        "position": r[3],
                        "stack_depth": r[4],
                        "game_type": r[5],
                        "color_palette": json.loads(r[6]) if r[6] else {},
                        "created_at": r[7],
                        "updated_at": r[8]
                    } for r in rows
                ]
            finally:
                conn.close()

    def get_range(self, range_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """SELECT id, name, folder_id, position, stack_depth, game_type, grid_data, color_palette, created_at, updated_at
                       FROM ranges WHERE id = ?""",
                    (range_id,)
                ).fetchone()
                if row:
                    return {
                        "id": row[0],
                        "name": row[1],
                        "folder_id": row[2],
                        "position": row[3],
                        "stack_depth": row[4],
                        "game_type": row[5],
                        "grid_data": json.loads(row[6]),
                        "color_palette": json.loads(row[7]) if row[7] else {},
                        "created_at": row[8],
                        "updated_at": row[9]
                    }
                return None
            finally:
                conn.close()

    def create_range(self, name: str, folder_id: Optional[str], position: str, stack_depth: int,
                     game_type: str, grid_data: List[Any], color_palette: Dict[str, str]) -> Dict[str, Any]:
        with self.lock:
            conn = self._connect()
            try:
                range_id = str(uuid.uuid4())
                grid_json = json.dumps(grid_data)
                palette_json = json.dumps(color_palette)
                now = datetime.now().isoformat()
                conn.execute(
                    """INSERT INTO ranges (id, name, folder_id, position, stack_depth, game_type, grid_data, color_palette, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (range_id, name, folder_id, position, stack_depth, game_type, grid_json, palette_json, now, now)
                )
                conn.commit()
                return {
                    "id": range_id,
                    "name": name,
                    "folder_id": folder_id,
                    "position": position,
                    "stack_depth": stack_depth,
                    "game_type": game_type,
                    "created_at": now,
                    "updated_at": now
                }
            finally:
                conn.close()

    def update_range(self, range_id: str, name: str, folder_id: Optional[str], position: str, stack_depth: int,
                     game_type: str, grid_data: List[Any], color_palette: Dict[str, str]) -> bool:
        with self.lock:
            conn = self._connect()
            try:
                grid_json = json.dumps(grid_data)
                palette_json = json.dumps(color_palette)
                now = datetime.now().isoformat()
                cursor = conn.execute(
                    """UPDATE ranges SET name = ?, folder_id = ?, position = ?, stack_depth = ?, game_type = ?,
                                         grid_data = ?, color_palette = ?, updated_at = ?
                       WHERE id = ?""",
                    (name, folder_id, position, stack_depth, game_type, grid_json, palette_json, now, range_id)
                )
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def delete_range(self, range_id: str) -> bool:
        with self.lock:
            conn = self._connect()
            try:
                cursor = conn.execute("DELETE FROM ranges WHERE id = ?", (range_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()
