"""화면 색상/글꼴 (v1.1 새 디자인).

- 왼쪽 진한 초록 세로 메뉴 + 밝은 회색 작업 영역 + 흰 카드
- 상태 색: 신규=주황, 추가발주=분홍, 입력 중=파랑, 완료=초록, B그룹=호박색, 기사발주=보라
"""

FONT_FAMILY = "Malgun Gothic"

COLORS = {
    "bg": "#F2F4F3",
    "panel": "#FFFFFF",
    "ink": "#1B1F23",
    "muted": "#66707A",
    "faint": "#98A1AA",
    "line": "#E1E5E8",
    "line_soft": "#EEF1F2",
    "brand": "#0F6E56",
    "brand_dark": "#085041",
    "brand_deep": "#06372D",
    "brand_soft": "#E1F5EE",
    "brand_text_on_dark": "#9FE1CB",
    "new": "#D85A30",
    "new_bg": "#FAECE7",
    "new_text": "#712B13",
    "additional": "#C2255C",
    "additional_bg": "#FBEAF0",
    "additional_text": "#72243E",
    "entering": "#185FA5",
    "entering_bg": "#E6F1FB",
    "entering_text": "#0C447C",
    "done": "#3B6D11",
    "done_bg": "#EAF3DE",
    "done_text": "#27500A",
    "cancelled": "#6B7280",
    "cancelled_bg": "#F1F2F4",
    "cancelled_text": "#444441",
    "danger": "#A32D2D",
    "danger_bg": "#FCEBEB",
    "note_bg": "#FFF8DB",
    "note_line": "#F0D978",
    "group_b": "#854F0B",
    "group_b_bg": "#FAEEDA",
    "group_b_text": "#633806",
    "driver": "#534AB7",
    "driver_bg": "#EEEDFE",
    "driver_text": "#3C3489",
    "merged": "#0F6E56",
    "merged_bg": "#E1F5EE",
    "merged_text": "#085041",
}

C = COLORS

STYLESHEET = f"""
* {{ font-family: "{FONT_FAMILY}", "Segoe UI", sans-serif; font-size: 11pt; color: {C['ink']}; }}
QMainWindow, QDialog {{ background: {C['bg']}; }}
QWidget#Workspace {{ background: {C['bg']}; }}

/* 왼쪽 세로 메뉴 */
QFrame#Rail {{ background: {C['brand_dark']}; border: none; }}
QFrame#Rail QLabel {{ color: {C['brand_text_on_dark']}; }}
QLabel#RailLogo {{ background: white; border-radius: 12px; }}
QToolButton#RailButton {{ background: transparent; border: none; border-radius: 12px; color: {C['brand_text_on_dark']};
  font-size: 10pt; font-weight: 700; padding: 8px 2px; min-width: 66px; }}
QToolButton#RailButton:hover {{ background: rgba(255,255,255,0.08); }}
QToolButton#RailButton:checked {{ background: {C['brand']}; color: white; }}
QToolButton#RailButton::menu-indicator {{ image: none; }}
QLabel#RailBadge {{ background: #E24B4A; color: white; border-radius: 9px; padding: 0 6px; font-size: 9pt; font-weight: 800; }}
QLabel#RailStatus {{ font-size: 9pt; font-weight: 700; }}

/* 상단 헤더 */
QLabel#PageTitle {{ font-size: 17pt; font-weight: 800; }}
QLabel#PageSub {{ color: {C['muted']}; font-size: 10pt; }}
QLabel#StaffChip {{ background: white; border: 1px solid {C['line']}; border-radius: 16px; padding: 6px 14px; font-weight: 700; color: {C['muted']}; }}
QFrame#Stat {{ background: white; border: 1px solid {C['line']}; border-radius: 12px; }}
QLabel#StatValue {{ font-size: 20pt; font-weight: 800; }}
QLabel#StatLabel {{ color: {C['muted']}; font-size: 9.5pt; font-weight: 700; }}

/* 버튼 */
QPushButton {{ background: white; border: 1px solid {C['line']}; border-radius: 10px; padding: 8px 14px; font-weight: 700; }}
QPushButton:hover {{ border-color: {C['brand']}; }}
QPushButton:disabled {{ color: #A0A7B0; background: #F1F3F5; }}
QPushButton#Ghost {{ background: transparent; border: 1px solid {C['line']}; }}
QPushButton#Primary {{ background: {C['done']}; color: white; border: none; font-size: 14pt; padding: 12px 26px; border-radius: 12px; }}
QPushButton#Primary:hover {{ background: {C['done_text']}; }}
QPushButton#Start {{ background: {C['entering']}; color: white; border: none; font-size: 14pt; padding: 12px 22px; border-radius: 12px; }}
QPushButton#Start:hover {{ background: {C['entering_text']}; }}
QPushButton#Secondary {{ font-size: 11pt; padding: 10px 14px; }}
QPushButton#Danger {{ color: {C['danger']}; font-size: 11pt; padding: 10px 14px; }}
QPushButton#Danger:hover {{ border-color: {C['danger']}; background: {C['danger_bg']}; }}
QPushButton#Chip {{ border-radius: 14px; padding: 5px 12px; font-size: 10pt; color: {C['muted']}; }}
QPushButton#Chip:checked {{ background: {C['brand']}; border-color: {C['brand']}; color: white; }}

/* 입력 */
QLineEdit, QComboBox, QDateEdit {{ background: white; border: 1px solid {C['line']}; border-radius: 10px; padding: 7px 12px; min-height: 22px; }}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus {{ border-color: {C['brand']}; }}
QCheckBox {{ color: {C['muted']}; font-size: 10pt; }}
QTabWidget::pane {{ border: none; }}
QTabBar::tab {{ height: 0; width: 0; padding: 0; margin: 0; border: none; }}

/* 목록 */
QListWidget {{ background: transparent; border: none; outline: none; }}
QListWidget::item {{ border: none; margin: 0 0 8px 0; }}
QListWidget::item:selected {{ background: transparent; }}
QFrame#ListPanel {{ background: white; border: 1px solid {C['line']}; border-radius: 16px; }}
QFrame#Card {{ background: white; border: 1px solid {C['line']}; border-radius: 12px; }}
QFrame#Card:hover {{ border-color: #B9C4CC; }}
QFrame#Card[selected="true"] {{ border: 2px solid {C['brand']}; background: #FAFDFC; }}
QLabel#Avatar {{ border-radius: 18px; font-weight: 800; font-size: 12pt; }}
QLabel#CardName {{ font-size: 12pt; font-weight: 800; }}
QLabel#CardMeta {{ color: {C['muted']}; font-size: 9.5pt; }}
QLabel#CardTime {{ color: {C['faint']}; font-size: 9pt; font-weight: 700; }}
QLabel#GroupHeader {{ color: {C['muted']}; font-weight: 800; padding: 8px 4px 2px 4px; }}

/* 상세 */
QFrame#Panel {{ background: white; border: 1px solid {C['line']}; border-radius: 16px; }}
QFrame#ActionBar {{ background: white; border: 1px solid {C['line']}; border-radius: 16px; }}
QLabel#Headline {{ font-size: 18pt; font-weight: 900; }}
QLabel#DetailSub {{ color: {C['muted']}; font-size: 10pt; }}
QLabel#Badge {{ border-radius: 10px; padding: 3px 10px; font-weight: 800; font-size: 9.5pt; }}
QFrame#InfoBox {{ background: #F6F8F7; border-radius: 12px; }}
QFrame#InfoBox[accent="true"] {{ background: {C['entering_bg']}; }}
QLabel#InfoKey {{ color: {C['muted']}; font-size: 9.5pt; font-weight: 700; }}
QLabel#InfoValue {{ font-size: 12.5pt; font-weight: 800; }}
QLabel#Note {{ background: {C['note_bg']}; border: 1px solid {C['note_line']}; border-radius: 10px; padding: 10px 12px; font-size: 12pt; }}
QLabel#Banner {{ border-radius: 10px; padding: 10px 12px; font-size: 11.5pt; font-weight: 700; }}
QTableWidget {{ background: white; border: none; gridline-color: transparent; font-size: 12.5pt; alternate-background-color: #F7F9F8; }}
QTableWidget::item {{ padding: 8px 6px; border-bottom: 1px solid {C['line_soft']}; }}
QTableWidget::item:selected {{ background: {C['brand_soft']}; color: {C['ink']}; }}
QHeaderView::section {{ background: white; border: none; border-bottom: 2px solid {C['line']}; padding: 8px 6px; font-weight: 800; font-size: 10pt; color: {C['muted']}; }}

QStatusBar {{ background: {C['bg']}; border-top: 1px solid {C['line']}; color: {C['muted']}; }}
QMenu {{ background: white; border: 1px solid {C['line']}; padding: 6px; border-radius: 10px; }}
QMenu::item {{ padding: 8px 24px; border-radius: 6px; }}
QMenu::item:selected {{ background: {C['brand_soft']}; }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: #CBD3D9; border-radius: 4px; min-height: 30px; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}

/* 알림 팝업 */
QFrame#Toast {{ background: white; border: 2px solid {C['new']}; border-radius: 14px; }}
QFrame#Toast[kind="additional"] {{ border-color: {C['additional']}; }}
QFrame#Toast[kind="changed"], QFrame#Toast[kind="cancelled"] {{ border-color: {C['entering']}; }}
QFrame#Toast[kind="reminder"] {{ border-color: #E8A400; }}
QLabel#ToastTitle {{ font-size: 13pt; font-weight: 900; }}
QLabel#ToastBody {{ font-size: 11pt; color: {C['ink']}; }}
QLabel#ToastHint {{ font-size: 9pt; color: {C['muted']}; }}
QPushButton#ToastClose {{ border: none; background: transparent; font-size: 13pt; padding: 0 4px; color: {C['muted']}; }}
"""


def badge_style(kind: str) -> str:
    color = COLORS.get(f"{kind}_text") or COLORS.get(kind, COLORS["muted"])
    background = COLORS.get(f"{kind}_bg", "#F1F2F4")
    return f"color: {color}; background: {background};"


AVATAR_PALETTE = [
    ("#FAECE7", "#993C1D"), ("#EEEDFE", "#3C3489"), ("#FAEEDA", "#633806"), ("#E6F1FB", "#0C447C"),
    ("#E1F5EE", "#085041"), ("#FBEAF0", "#72243E"), ("#EAF3DE", "#27500A"),
]


def avatar_style(seed: str) -> str:
    background, color = AVATAR_PALETTE[sum(ord(c) for c in (seed or "?")) % len(AVATAR_PALETTE)]
    return f"background: {background}; color: {color};"


def avatar_text(name: str) -> str:
    """'태승급식소 120-13' → '태'. 숫자/기호로 시작하면 첫 한글/영문 글자."""
    for ch in name or "":
        if ch.isalpha():
            return ch.upper()
    return "?"
