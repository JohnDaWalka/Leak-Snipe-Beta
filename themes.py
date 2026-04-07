"""
Theme system for Poker Hand Tracker.
Manages color definitions and theme-related utilities.
"""

# Theme definitions with color palettes for different UI themes
THEMES = {
    "Midnight Purple": {
        "bg_base":       "#13111c",   # deep purple-black
        "bg_panel":      "#1c1929",   # dark purple panel
        "bg_accent":     "#4a2d8a",   # vibrant purple accent
        "bg_input":      "#110f1a",   # darkest purple input
        "bg_card":       "#252238",   # raised purple surface
        "bg_hover":      "#6c3ec7",   # bright purple hover
        "border":        "#332e4a",   # muted purple border
        "border_hl":     "#7c4dff",   # neon purple highlight
        "text":          "#e8e6f0",   # lavender white
        "text_dim":      "#9590b0",   # dim lavender
        "text_header":   "#ffd740",   # amber gold headers
        "green":         "#69f0ae",   # mint green wins
        "red":           "#ff5252",   # bright red losses
        "yellow":        "#ffd740",   # amber warnings
        "gold":          "#ffd740",   # amber highlights
        "orange":        "#ff6e40",   # coral orange
        "select_bg":     "#3d2b70",   # purple selection
        "row_win":       "#e8e6f0",
        "row_loss":      "#d4a0b0",
        "row_even":      "#9590b0",
        "graph_bg":      "#13111c",
        "graph_face":    "#1c1929",
        "graph_grid":    "#332e4a",
        "graph_line":    "#69f0ae",
        "graph_bar1":    "#7c4dff",
        "graph_bar2":    "#ff5252",
        "pie_colors":    ["#7c4dff", "#69f0ae", "#ff5252", "#ffd740", "#e040fb", "#18ffff"],
    },
    "Slate Blue": {
        "bg_base":       "#0f1923",   # deep navy slate
        "bg_panel":      "#172a3a",   # dark steel blue
        "bg_accent":     "#1e6091",   # rich ocean blue
        "bg_input":      "#0c1520",   # near-black navy
        "bg_card":       "#1f3347",   # steel blue card
        "bg_hover":      "#2196f3",   # bright blue hover
        "border":        "#2a4560",   # steel border
        "border_hl":     "#42a5f5",   # bright blue highlight
        "text":          "#e3eaf0",   # cool white
        "text_dim":      "#7a9bb5",   # muted steel
        "text_header":   "#ffc107",   # amber headers
        "green":         "#4caf50",   # standard green
        "red":           "#ef5350",   # warm red
        "yellow":        "#ffc107",   # amber
        "gold":          "#ffca28",   # bright gold
        "orange":        "#ff7043",   # deep orange
        "select_bg":     "#1a4a6e",
        "row_win":       "#e3eaf0",
        "row_loss":      "#cf9090",
        "row_even":      "#7a9bb5",
        "graph_bg":      "#0f1923",
        "graph_face":    "#172a3a",
        "graph_grid":    "#2a4560",
        "graph_line":    "#4caf50",
        "graph_bar1":    "#2196f3",
        "graph_bar2":    "#ef5350",
        "pie_colors":    ["#2196f3", "#4caf50", "#ef5350", "#ffc107", "#ab47bc", "#26c6da"],
    },
    "High Contrast": {
        "bg_base":       "#000000",
        "bg_panel":      "#1a1a1a",
        "bg_accent":     "#005fa3",
        "bg_input":      "#0d0d0d",
        "bg_card":       "#262626",
        "bg_hover":      "#0078d4",
        "border":        "#555555",
        "border_hl":     "#00b7ff",
        "text":          "#ffffff",
        "text_dim":      "#bbbbbb",
        "text_header":   "#ffdd00",
        "green":         "#00ff7f",
        "red":           "#ff4444",
        "yellow":        "#ffdd00",
        "gold":          "#ffdd00",
        "orange":        "#ff8800",
        "select_bg":     "#005fa3",
        "row_win":       "#ffffff",
        "row_loss":      "#ff9999",
        "row_even":      "#bbbbbb",
        "graph_bg":      "#000000",
        "graph_face":    "#1a1a1a",
        "graph_grid":    "#555555",
        "graph_line":    "#00ff7f",
        "graph_bar1":    "#0078d4",
        "graph_bar2":    "#ff4444",
        "pie_colors":    ["#0078d4", "#00ff7f", "#ff4444", "#ffdd00", "#cc66ff", "#00cccc"],
    },
    "Felt Green": {
        "bg_base":       "#0e2a1e",   # deeper felt green
        "bg_panel":      "#173628",   # rich dark felt
        "bg_accent":     "#1a7a4a",   # emerald accent
        "bg_input":      "#0b2218",   # darkest green input
        "bg_card":       "#204a36",   # raised felt card
        "bg_hover":      "#2ecc71",   # bright emerald hover
        "border":        "#2d5a42",   # green-tinted border
        "border_hl":     "#2ecc71",   # emerald highlight
        "text":          "#f0efe4",   # warm cream text
        "text_dim":      "#7ca08e",   # sage dim
        "text_header":   "#f1c40f",   # gold headers
        "green":         "#2ecc71",   # wins
        "red":           "#e74c3c",   # losses
        "yellow":        "#f39c12",   # caution
        "gold":          "#f1c40f",   # highlights
        "orange":        "#e67e22",   # tilt
        "select_bg":     "#1a5c3a",
        "row_win":       "#f0efe4",
        "row_loss":      "#d4a0a0",
        "row_even":      "#7ca08e",
        "graph_bg":      "#0e2a1e",
        "graph_face":    "#173628",
        "graph_grid":    "#2d5a42",
        "graph_line":    "#2ecc71",
        "graph_bar1":    "#1a7a4a",
        "graph_bar2":    "#e74c3c",
        "pie_colors":    ["#1a7a4a", "#2ecc71", "#e74c3c", "#f39c12", "#8e44ad", "#16a085"],
    },
    "Crimson Night": {
        "bg_base":       "#1a0f14",   # deep dark red-black
        "bg_panel":      "#261820",   # dark crimson panel
        "bg_accent":     "#8b2252",   # rich crimson accent
        "bg_input":      "#150c11",   # darkest crimson
        "bg_card":       "#30202a",   # raised dark surface
        "bg_hover":      "#c62828",   # bright red hover
        "border":        "#4a2838",   # crimson border
        "border_hl":     "#e91e63",   # hot pink highlight
        "text":          "#f0e8ec",   # warm pink-white
        "text_dim":      "#a08090",   # muted mauve
        "text_header":   "#ff8a65",   # warm coral headers
        "green":         "#66bb6a",   # soft green
        "red":           "#ef5350",   # vivid red
        "yellow":        "#ffb74d",   # warm amber
        "gold":          "#ff8a65",   # coral gold
        "orange":        "#ff7043",   # deep coral
        "select_bg":     "#5a1a38",
        "row_win":       "#f0e8ec",
        "row_loss":      "#d09090",
        "row_even":      "#a08090",
        "graph_bg":      "#1a0f14",
        "graph_face":    "#261820",
        "graph_grid":    "#4a2838",
        "graph_line":    "#66bb6a",
        "graph_bar1":    "#e91e63",
        "graph_bar2":    "#ef5350",
        "pie_colors":    ["#e91e63", "#66bb6a", "#ef5350", "#ffb74d", "#ce93d8", "#4dd0e1"],
    },
    "Carbon": {
        "bg_base":       "#141414",   # true dark carbon
        "bg_panel":      "#1e1e1e",   # neutral dark gray
        "bg_accent":     "#333333",   # medium gray accent
        "bg_input":      "#111111",   # near-black input
        "bg_card":       "#282828",   # raised gray surface
        "bg_hover":      "#484848",   # light gray hover
        "border":        "#3a3a3a",   # neutral border
        "border_hl":     "#00e676",   # neon green highlight
        "text":          "#e0e0e0",   # clean gray-white
        "text_dim":      "#888888",   # mid gray
        "text_header":   "#00e676",   # neon green headers
        "green":         "#00e676",   # neon green
        "red":           "#ff1744",   # neon red
        "yellow":        "#ffea00",   # neon yellow
        "gold":          "#00e676",   # neon green highlights
        "orange":        "#ff9100",   # neon orange
        "select_bg":     "#2a2a3a",
        "row_win":       "#e0e0e0",
        "row_loss":      "#c09090",
        "row_even":      "#888888",
        "graph_bg":      "#141414",
        "graph_face":    "#1e1e1e",
        "graph_grid":    "#3a3a3a",
        "graph_line":    "#00e676",
        "graph_bar1":    "#448aff",
        "graph_bar2":    "#ff1744",
        "pie_colors":    ["#448aff", "#00e676", "#ff1744", "#ffea00", "#e040fb", "#18ffff"],
    },
    "Ocean Deep": {
        "bg_base":       "#0a1628",   # deep ocean blue-black
        "bg_panel":      "#0f2038",   # dark ocean panel
        "bg_accent":     "#0d4f8b",   # deep ocean accent
        "bg_input":      "#081220",   # abyss input
        "bg_card":       "#152a48",   # ocean card surface
        "bg_hover":      "#0288d1",   # bright ocean hover
        "border":        "#1a3a5c",   # deep blue border
        "border_hl":     "#00b0ff",   # electric blue highlight
        "text":          "#e0ecf4",   # ice white
        "text_dim":      "#6a90b0",   # ocean gray
        "text_header":   "#00e5ff",   # cyan headers
        "green":         "#00c853",   # sea green
        "red":           "#ff1744",   # signal red
        "yellow":        "#ffab00",   # amber
        "gold":          "#00e5ff",   # cyan highlights
        "orange":        "#ff6d00",   # deep orange
        "select_bg":     "#0a3260",
        "row_win":       "#e0ecf4",
        "row_loss":      "#c0a0a0",
        "row_even":      "#6a90b0",
        "graph_bg":      "#0a1628",
        "graph_face":    "#0f2038",
        "graph_grid":    "#1a3a5c",
        "graph_line":    "#00c853",
        "graph_bar1":    "#00b0ff",
        "graph_bar2":    "#ff1744",
        "pie_colors":    ["#00b0ff", "#00c853", "#ff1744", "#ffab00", "#aa00ff", "#00e5ff"],
    },
}


def lighten(hex_color: str, amount: float = 0.15) -> str:
    """Lighten a hex color by a fraction (0.0 to 1.0)."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = min(255, int(r + (255 - r) * amount))
    g = min(255, int(g + (255 - g) * amount))
    b = min(255, int(b + (255 - b) * amount))
    return f"#{r:02x}{g:02x}{b:02x}"


def darken(hex_color: str, amount: float = 0.15) -> str:
    """Darken a hex color by a fraction (0.0 to 1.0)."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = max(0, int(r * (1 - amount)))
    g = max(0, int(g * (1 - amount)))
    b = max(0, int(b * (1 - amount)))
    return f"#{r:02x}{g:02x}{b:02x}"


def blend(hex_color_a: str, hex_color_b: str, amount: float = 0.5) -> str:
    """Blend two hex colors by the supplied fraction (0.0 to 1.0)."""
    hex_color_a = hex_color_a.lstrip("#")
    hex_color_b = hex_color_b.lstrip("#")
    a_r, a_g, a_b = int(hex_color_a[:2], 16), int(hex_color_a[2:4], 16), int(hex_color_a[4:6], 16)
    b_r, b_g, b_b = int(hex_color_b[:2], 16), int(hex_color_b[2:4], 16), int(hex_color_b[4:6], 16)
    r = int(a_r + (b_r - a_r) * amount)
    g = int(a_g + (b_g - a_g) * amount)
    b = int(a_b + (b_b - a_b) * amount)
    return f"#{r:02x}{g:02x}{b:02x}"
