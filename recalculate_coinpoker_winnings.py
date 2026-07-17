#!/usr/bin/env python3
import sqlite3
import json
import os
import sys

# Ensure sidecar path is in sys.path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sidecar"))
from parsers import HandParser

def main():
    db_path = "poker_hands.db"
    settings_path = "settings.json"
    
    if not os.path.exists(db_path):
        print(f"Error: Database not found: {db_path}")
        return
        
    # Load settings to get hero names
    if os.path.exists(settings_path):
        with open(settings_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
    else:
        print("Warning: settings.json not found, using default hero names")
        settings = {"hero_names": {"CoinPoker": "jdwalka,GBOSS101"}}
        
    parser = HandParser(settings)
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Select all CoinPoker hands
    cursor.execute("SELECT hand_id, hero_won, raw_text FROM hands WHERE site = 'CoinPoker'")
    hands = cursor.fetchall()
    print(f"Found {len(hands)} CoinPoker hands in database to process...")
    
    updated_count = 0
    mismatch_count = 0
    
    for row in hands:
        hand_id = row["hand_id"]
        old_hero_won = row["hero_won"]
        raw_text = row["raw_text"]
        
        try:
            # Parse the hand history using the updated logic
            parsed_hands = parser.parse_coinpoker_json_log(raw_text)
            if not parsed_hands:
                print(f"Warning: Could not parse hand {hand_id}")
                continue
                
            new_hero_won = parsed_hands[0].hero_won
            
            if abs(old_hero_won - new_hero_won) > 0.001:
                # Update the database
                conn.execute(
                    "UPDATE hands SET hero_won = ? WHERE hand_id = ?",
                    (new_hero_won, hand_id)
                )
                mismatch_count += 1
                updated_count += 1
                if mismatch_count <= 10:
                    print(f"  Recalculated {hand_id}: {old_hero_won} -> {new_hero_won}")
            
        except Exception as e:
            print(f"Error processing hand {hand_id}: {e}")
            
    conn.commit()
    conn.close()
    
    print("=" * 60)
    print(f"Recalculation complete.")
    print(f"Total hands updated/fixed: {updated_count}")
    print("=" * 60)

if __name__ == "__main__":
    main()
