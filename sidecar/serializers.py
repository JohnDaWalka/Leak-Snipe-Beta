"""JSON serializers for LeakSnipe domain objects."""

from __future__ import annotations

from typing import Any, Dict, List

from models import Hand


def hand_to_summary(hand: Hand, settings: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "hand_id": hand.hand_id,
        "site": hand.site,
        "date": hand.date.isoformat() if hand.date else None,
        "game_type": hand.game_type,
        "table_name": hand.table_name,
        "hero_cards": hand.hero_cards,
        "board_cards": hand.board_cards,
        "hero_won": hand.hero_won,
        "hero_position": hand.hero_position,
        "hero_name": hand.hero_name(settings),
        "hero_player": getattr(hand, "hero_player", ""),
        "pot": hand.pot,
        "is_tournament": hand.is_tournament,
        "tags": list(hand.tags),
    }


def get_seat_positions(players_dict: Dict[int, Dict[str, Any]], button_seat: int) -> Dict[int, str]:
    if not players_dict or not button_seat:
        return {}
    active_seats = sorted(players_dict.keys())
    if button_seat not in active_seats:
        return {}
    n = len(active_seats)
    btn_idx = active_seats.index(button_seat)
    
    positions = {}
    if n == 2:
        positions[active_seats[btn_idx]] = "BTN"
        positions[active_seats[(btn_idx + 1) % 2]] = "BB"
        return positions
        
    for idx, seat in enumerate(active_seats):
        dist = (idx - btn_idx) % n
        if dist == 0:
            positions[seat] = "BTN"
        elif dist == 1:
            positions[seat] = "SB"
        elif dist == 2:
            positions[seat] = "BB"
        else:
            from_btn_backwards = n - dist
            if from_btn_backwards == 1:
                positions[seat] = "CO"
            elif from_btn_backwards == 2:
                positions[seat] = "HJ" if n > 6 else "MP"
            elif from_btn_backwards == 3:
                positions[seat] = "MP" if n > 6 else "UTG"
            elif from_btn_backwards == 4:
                positions[seat] = "UTG+2" if n > 8 else "UTG"
            elif from_btn_backwards == 5:
                positions[seat] = "UTG+1"
            elif from_btn_backwards == 6:
                positions[seat] = "UTG"
            else:
                positions[seat] = "UTG"
    return positions


def hand_to_detail(hand: Hand, settings: Dict[str, Any]) -> Dict[str, Any]:
    payload = hand_to_summary(hand, settings)
    
    # Calculate positions for players at the table
    positions = get_seat_positions(hand.players, hand.button_seat)
    players_detail = {}
    for seat, info in hand.players.items():
        players_detail[str(seat)] = {
            "name": info["name"],
            "stack": info["stack"],
            "is_hero": info["is_hero"],
            "position": positions.get(seat, "—"),
        }
        
    payload.update(
        {
            "board_cards": hand.board_cards,
            "streets": hand.streets,
            "players": players_detail,
            "winners": hand.winners,
            "raw_text": hand.raw_text,
            "max_seats": hand.max_seats,
            "button_seat": hand.button_seat,
            "rake": hand.rake,
        }
    )
    return payload


def hands_to_summaries(hands: List[Hand], settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [hand_to_summary(h, settings) for h in hands]
