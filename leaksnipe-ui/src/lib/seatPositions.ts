/** Seat badge anchor positions — ported from poker_gui.py SEAT_POSITIONS */

export type SeatLayoutKey = 2 | 6 | 9;



export const HUD_EDGE_MARGIN_PCT_DEFAULT = 0.12;

export const HUD_BADGE_SCALE_DEFAULT = 1.5;



/** Side seats inset from left/right so badges avoid BetACR action buttons and info panels. */

export const SEAT_POSITIONS: Record<SeatLayoutKey, Record<number, [number, number]>> = {

  2: {

    1: [0.5, 0.82],

    2: [0.5, 0.12],

  },

  6: {

    1: [0.5, 0.88],

    2: [0.76, 0.74],

    3: [0.78, 0.34],

    4: [0.62, 0.17],

    5: [0.38, 0.17],

    6: [0.22, 0.34],

  },

  9: {

    1: [0.5, 0.88],

    2: [0.72, 0.82],

    3: [0.78, 0.6],

    4: [0.72, 0.18],

    5: [0.62, 0.16],

    6: [0.38, 0.16],

    7: [0.28, 0.18],

    8: [0.22, 0.6],

    9: [0.28, 0.82],

  },

};



export function resolveLayoutKey(

  maxSeats: number,

  forced?: string | null,

): SeatLayoutKey {

  const forcedKey = (forced || "auto").toLowerCase();

  if (forcedKey === "2max") return 2;

  if (forcedKey === "6max") return 6;

  if (forcedKey === "9max") return 9;

  const keys: SeatLayoutKey[] = [2, 6, 9];

  return keys.reduce((best, k) =>

    Math.abs(k - maxSeats) < Math.abs(best - maxSeats) ? k : best,

  );

}



export function clampSeatXPct(xPct: number, edgeMarginPct = HUD_EDGE_MARGIN_PCT_DEFAULT): number {

  const margin = Math.max(0.05, Math.min(0.25, edgeMarginPct));

  return Math.max(margin, Math.min(1 - margin, xPct));

}



type SeatMapEntry = { name?: string; is_hero?: boolean };



/**
 * Map hand-history seat numbers to layout slots with hero anchored at slot 1
 * (bottom). Rotation is computed from real seat-number distance around the
 * table, not from index position within the (often gappy) list of currently
 * occupied seats — empty seats between two players must not compress their
 * visual spacing, or badges land on the wrong physical positions.
 */

export function buildHeroAnchoredSeatSlots(

  seatMap: Record<string, SeatMapEntry>,

  layoutKey: SeatLayoutKey,

): Record<number, number> {

  const layout = SEAT_POSITIONS[layoutKey];

  const layoutSlots = Object.keys(layout)

    .map(Number)

    .sort((a, b) => a - b);

  if (!layoutSlots.length || !Object.keys(seatMap).length) {

    return {};

  }



  const seatsSorted = Object.keys(seatMap)

    .map(Number)

    .sort((a, b) => a - b);

  const heroSeat =

    seatsSorted.find((seat) => seatMap[String(seat)]?.is_hero) ?? seatsSorted[0];

  const ringSize = layoutSlots.length;



  const result: Record<number, number> = {};

  for (const seat of seatsSorted) {

    // seat - heroSeat, matching poker_gui.py's original build_hero_anchored_seat_slots
    // (verified against its actual formula, not guessed): on a fully-occupied
    // table its index-rank-based offset reduces to exactly this direction.
    const offset = ((seat - heroSeat) % ringSize + ringSize) % ringSize;

    result[seat] = layoutSlots[offset];

  }

  return result;

}


