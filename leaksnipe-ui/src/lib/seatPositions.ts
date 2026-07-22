/** Seat badge anchor positions — ported from poker_gui.py SEAT_POSITIONS */

export type SeatLayoutKey = 2 | 6 | 9;



export const HUD_EDGE_MARGIN_PCT_DEFAULT = 0.12;

export const HUD_BADGE_SCALE_DEFAULT = 0.9;



/** Side seats inset from left/right so badges avoid BetACR action buttons and info panels. */

export const SEAT_POSITIONS: Record<SeatLayoutKey, Record<number, [number, number]>> = {

  2: {

    1: [0.5, 0.82],

    2: [0.5, 0.12],

  },

  // Calibrated against a live CoinPoker 6-max table (2026-07-19): measured
  // avatar centers as fractions of the table window were TL(0.14,0.16),
  // TC(0.50,0.14), TR(0.86,0.16), BL(0.12,0.60), BR(0.88,0.60) — slots below
  // are those nudged a little toward the table center so badges sit next to,
  // not on top of, the avatar/nameplate.
  6: {

    1: [0.5, 0.88],

    2: [0.86, 0.58],

    3: [0.84, 0.20],

    4: [0.5, 0.16],

    5: [0.16, 0.20],

    6: [0.14, 0.58],

  },

  9: {

    1: [0.5, 0.88],

    2: [0.72, 0.82],

    3: [0.78, 0.6],

    4: [0.72, 0.18],

    5: [0.62, 0.1],

    6: [0.38, 0.1],

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
 * Sites whose seat numbers advance counter-clockwise around the table (e.g.
 * BetACR — matches SEAT_POSITIONS' own slot ordering, which was fitted to
 * BetACR tables). Any site NOT in this set is treated as clockwise (verified
 * live against CoinPoker on 2026-07-19: seat N+1 sits to the hero's left,
 * i.e. clockwise — the opposite of BetACR) and has its offset direction
 * flipped in buildHeroAnchoredSeatSlots. If a new site turns out to also be
 * counter-clockwise, add it here rather than guessing.
 */
export const COUNTER_CLOCKWISE_SEATING_SITES = new Set(["BetACR", "ACR"]);

/**
 * Map hand-history seat numbers to layout slots with hero anchored at slot 1
 * (bottom). Rotation is computed from real seat-number distance around the
 * table, not from index position within the (often gappy) list of currently
 * occupied seats — empty seats between two players must not compress their
 * visual spacing, or badges land on the wrong physical positions.
 *
 * `site` controls rotation direction (see COUNTER_CLOCKWISE_SEATING_SITES) —
 * different poker clients number seats in opposite directions around the
 * table, so the same offset formula mirrors badges to the wrong side if the
 * site isn't accounted for.
 */

export function buildHeroAnchoredSeatSlots(

  seatMap: Record<string, SeatMapEntry>,

  layoutKey: SeatLayoutKey,

  site?: string | null,

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

  // seat - heroSeat matches poker_gui.py's original formula, which was fitted
  // to BetACR (counter-clockwise seat numbering). Sites that number seats
  // clockwise instead (confirmed live for CoinPoker) need the offset direction
  // flipped, or every opponent lands mirrored to the wrong side of the table.
  const counterClockwise = !site || COUNTER_CLOCKWISE_SEATING_SITES.has(site);

  const result: Record<number, number> = {};

  for (const seat of seatsSorted) {

    const rawOffset = counterClockwise ? seat - heroSeat : heroSeat - seat;
    const offset = ((rawOffset % ringSize) + ringSize) % ringSize;

    result[seat] = layoutSlots[offset];

  }

  return result;

}


