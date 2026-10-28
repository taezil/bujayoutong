"""화면 색상/글꼴. 하루 종일 보는 화면이라 밝고 차분한 색 + 큰 글씨."""

FONT_FAMILY = "Malgun Gothic"

COLORS = {
    "bg": "#F4F6F8",
    "panel": "#FFFFFF",
    "ink": "#1F2328",
    "muted": "#5F6B7A",
    "line": "#DDE2E8",
    "brand": "#057241",
    "brand_dark": "#045A33",
    "new": "#D9480F",
    "new_bg": "#FFF1E8",
    "additional": "#C2255C",
    "additional_bg": "#FFEAF1",
    "entering": "#1C6ED6",
    "entering_bg": "#EAF2FF",
    "done": "#2B8A3E",
    "done_bg": "#EBF7EE",
    "cancelled": "#6B7280",
    "cancelled_bg": "#F1F2F4",
    "danger": "#C92A2A",
    "note_bg": "#FFF8DB",
}

STYLESHEET = f"""
* {{ font-family: "{FONT_FAMILY}", "Segoe UI", sans-serif; font-size: 11pt; color: {COLORS['ink']}; }}
QMainWindow, QDialog {{ background: {COLORS['bg']}; }}
QFrame#TopBar {{ background: {COLORS['brand']}; border: none; }}
QFrame#TopBar QLabel {{ color: white; }}
QLabel#AppTitle {{ font-size: 16pt; font-weight: 800; color: white; }}
QLabel#Pill {{ border-radius: 12px; padding: 4px 12px; font-weight: 700; }}
QLabel#Pill[state="ok"] {{ background: rgba(255,255,255,0.18); color: white; }}
QLabel#Pill[state="bad"] {{ background: {COLORS['danger']}; color: white; }}
QLabel#CountNew {{ background: white; color: {COLORS['new']}; border-radius: 12px; padding: 4px 12px; font-weight: 800; font-size: 12pt; }}
QPushButton {{ background: white; border: 1px solid {COLORS['line']}; border-radius: 8px; padding: 8px 14px; font-weight: 700; }}
QPushButton:hover {{ border-color: {COLORS['brand']}; }}
QPushButton:disabled {{ color: #A0A7B0; background: #F1F3F5; }}
QPushButton#TopButton {{ background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35); color: white; }}
QPushButton#TopButton:checked {{ background: white; color: {COLORS['brand_dark']}; }}
QPushButton#Primary {{ background: {COLORS['done']}; color: white; border: none; font-size: 15pt; padding: 12px 24px; }}
QPushButton#Primary:hover {{ background: #237032; }}
QPushButton#Start {{ background: {COLORS['entering']}; color: white; border: none; font-size: 15pt; padding: 12px 24px; }}
QPushButton#Start:hover {{ background: #155AB5; }}
QPushButton#Secondary {{ font-size: 12pt; padding: 10px 16px; }}
QPushButton#Danger {{ color: {COLORS['danger']}; font-size: 12pt; padding: 10px 16px; }}
QLineEdit, QComboBox, QDateEdit {{ background: white; border: 1px solid {COLORS['line']}; border-radius: 8px; padding: 6px 10px; min-height: 22px; }}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus {{ border-color: {COLORS['brand']}; }}
QTabWidget::pane {{ border: none; }}
QTabBar::tab {{ background: transparent; padding: 10px 22px; font-size: 12pt; font-weight: 700; color: {COLORS['muted']}; border-bottom: 3px solid transparent; }}
QTabBar::tab:selected {{ color: {COLORS['brand_dark']}; border-bottom: 3px solid {COLORS['brand']}; }}
QListWidget {{ background: transparent; border: none; outline: none; }}
QListWidget::item {{ border: none; margin: 0 0 6px 0; }}
QListWidget::item:selected {{ background: transparent; }}
QFrame#Card {{ background: white; border: 1px solid {COLORS['line']}; border-radius: 10px; }}
QFrame#Card[selected="true"] {{ border: 2px solid {COLORS['brand']}; }}
QFrame#Panel {{ background: white; border: 1px solid {COLORS['line']}; border-radius: 12px; }}
QLabel#Badge {{ border-radius: 10px; padding: 2px 10px; font-weight: 800; font-size: 10pt; }}
QLabel#GroupHeader {{ color: {COLORS['muted']}; font-weight: 800; padding: 8px 4px 2px 4px; }}
QLabel#Headline {{ font-size: 20pt; font-weight: 900; }}
QLabel#InfoKey {{ color: {COLORS['muted']}; font-size: 12pt; }}
QLabel#InfoValue {{ font-size: 13pt; font-weight: 700; }}
QLabel#Note {{ background: {COLORS['note_bg']}; border: 1px solid #F0D978; border-radius: 8px; padding: 10px; font-size: 13pt; }}
QLabel#Banner {{ border-radius: 8px; padding: 10px 12px; font-size: 12pt; font-weight: 700; }}
QTableWidget {{ background: white; border: 1px solid {COLORS['line']}; border-radius: 8px; gridline-color: #EEF1F4; font-size: 13pt; }}
QTableWidget::item {{ padding: 6px; }}
QTableWidget::item:selected {{ background: #E6F4EC; color: {COLORS['ink']}; }}
QHeaderView::section {{ background: #F7F8FA; border: none; border-bottom: 1px solid {COLORS['line']}; padding: 8px; font-weight: 800; font-size: 11pt; color: {COLORS['muted']}; }}
QStatusBar {{ background: white; border-top: 1px solid {COLORS['line']}; }}
QMenu {{ background: white; border: 1px solid {COLORS['line']}; padding: 6px; }}
QMenu::item {{ padding: 8px 24px; border-radius: 6px; }}
QMenu::item:selected {{ background: #E6F4EC; }}
QFrame#Toast {{ background: white; border: 2px solid {COLORS['new']}; border-radius: 12px; }}
QFrame#Toast[kind="additional"] {{ border-color: {COLORS['additional']}; }}
QFrame#Toast[kind="changed"], QFrame#Toast[kind="cancelled"] {{ border-color: {COLORS['entering']}; }}
QFrame#Toast[kind="reminder"] {{ border-color: #E8A400; }}
QLabel#ToastTitle {{ font-size: 13pt; font-weight: 900; }}
QLabel#ToastBody {{ font-size: 11pt; color: {COLORS['ink']}; }}
QLabel#ToastHint {{ font-size: 9pt; color: {COLORS['muted']}; }}
QPushButton#ToastClose {{ border: none; background: transparent; font-size: 13pt; padding: 0 4px; color: {COLORS['muted']}; }}
"""


def badge_style(kind: str) -> str:
    color = COLORS.get(kind, COLORS["muted"])
    background = COLORS.get(f"{kind}_bg", "#F1F2F4")
    return f"color: {color}; background: {background};"
