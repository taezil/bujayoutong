/**
 * 배송일·배송 시간(오전/오후 차수) 규칙.
 * 거래처 화면(달력)과 서버(주문 검증)가 같은 함수를 씁니다. 서버 전용 코드를 넣지 마세요.
 *
 * - 오늘 배송: openFrom(기본 01:00) ~ sameDayCutoff(기본 15:00) 사이에만 선택 가능. 그 밖에는 내일 이후만.
 *   (주문 자체는 24시간 가능)
 * - 오전 배송(오늘): amUntil(기본 10:00) 전 주문까지. 내일 이후 날짜는 언제나 가능 (예약·전날 발주)
 * - 오후 배송(오늘): pmRuns 마감시각 순서대로 1차·2차… 예) 2단지 ["13:00","15:00"] → 13시 전 1차, 15시 전 2차
 *   내일 이후 날짜의 오후 배송은 1차
 * - 차수가 하나뿐인 구역은 차수 번호를 저장하지 않음(run=0)
 */

export type DeliveryRule = {
  zone: string;
  openFrom: string;
  sameDayCutoff: string;
  amUntil: string;
  pmRuns: string[];
};

export type SlotChoice = {
  slot: "AM" | "PM";
  run: number;
  label: string;
  hint: string;
  available: boolean;
  reason: string;
};

export const DEFAULT_RULE: DeliveryRule = { zone: "", openFrom: "01:00", sameDayCutoff: "15:00", amUntil: "10:00", pmRuns: ["15:00"] };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanTime(value: unknown, fallback: string) {
  const text = String(value ?? "").trim().replace(/^(\d):/, "0$1:");
  return TIME.test(text) ? text : fallback;
}

/** "13:00, 15:00" → ["13:00","15:00"] (정렬·중복 제거, 최대 4차) */
export function parseRuns(value: unknown, fallback: string[] = DEFAULT_RULE.pmRuns) {
  const list = (Array.isArray(value) ? value : String(value ?? "").split(/[,\s/]+/))
    .map((item) => cleanTime(item, ""))
    .filter(Boolean);
  const unique = Array.from(new Set(list)).sort().slice(0, 4);
  return unique.length ? unique : fallback;
}

export function kstNow(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, time: `${pick("hour")}:${pick("minute")}` };
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function hourText(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const h = hour === 0 ? "밤 12시" : hour < 12 ? `오전 ${hour}시` : hour === 12 ? "낮 12시" : `오후 ${hour - 12}시`;
  return minute ? `${h} ${minute}분` : h;
}

export function todayOpen(rule: DeliveryRule, time: string) {
  return time >= rule.openFrom && time < rule.sameDayCutoff;
}

export function runLabel(run: number) {
  return run > 0 ? `${run}차` : "";
}

/** 그 날짜에 고를 수 있는 배송 시간 목록 (오전, 오후) */
export function slotChoices(rule: DeliveryRule, date: string, now = Date.now()): SlotChoice[] {
  const { date: today, time } = kstNow(now);
  const multi = rule.pmRuns.length > 1;
  if (!date || date < today) {
    return [
      { slot: "AM", run: 0, label: "오전 배송", hint: "", available: false, reason: "지난 날짜" },
      { slot: "PM", run: 0, label: "오후 배송", hint: "", available: false, reason: "지난 날짜" },
    ];
  }
  if (date > today) {
    return [
      { slot: "AM", run: 0, label: "오전 배송", hint: "예약 주문", available: true, reason: "" },
      { slot: "PM", run: multi ? 1 : 0, label: multi ? "오후 1차 배송" : "오후 배송", hint: "예약 주문", available: true, reason: "" },
    ];
  }
  const open = todayOpen(rule, time);
  const closedReason = time < rule.openFrom
    ? `오늘 배송은 ${hourText(rule.openFrom)}부터 주문 가능`
    : `오늘 배송 마감 (${hourText(rule.sameDayCutoff)})`;
  const amOk = open && time < rule.amUntil;
  const runIndex = rule.pmRuns.findIndex((cutoff) => time < cutoff);
  const pmOk = open && runIndex >= 0;
  const run = runIndex >= 0 ? runIndex + 1 : rule.pmRuns.length;
  return [
    {
      slot: "AM", run: 0, label: "오전 배송",
      hint: amOk ? `${hourText(rule.amUntil)} 전 주문까지` : "",
      available: amOk, reason: amOk ? "" : open ? `오전 배송 마감 (${hourText(rule.amUntil)})` : closedReason,
    },
    {
      slot: "PM", run: multi ? run : 0, label: multi ? `오후 ${run}차 배송` : "오후 배송",
      hint: pmOk ? `${hourText(rule.pmRuns[runIndex])} 전 주문까지` : "",
      available: pmOk, reason: pmOk ? "" : open ? `오후 배송 마감 (${hourText(rule.pmRuns[rule.pmRuns.length - 1])})` : closedReason,
    },
  ];
}

/** 오늘 고를 수 있는 배송 시간이 하나도 없으면 false → 달력에서 오늘을 막음 */
export function todaySelectable(rule: DeliveryRule, now = Date.now()) {
  return slotChoices(rule, kstNow(now).date, now).some((choice) => choice.available);
}

/**
 * 서버 검증. graceMinutes: 마감 직전 화면을 보고 누른 주문은 몇 분 봐줌.
 * 결과 run 은 서버가 접수 시각으로 다시 계산한 차수 (거래처가 보낸 값은 믿지 않음)
 */
export function resolveSlot(rule: DeliveryRule, date: string, slot: string, now = Date.now(), graceMinutes = 2) {
  const choices = slotChoices(rule, date, now - graceMinutes * 60000);
  const choice = choices.find((item) => item.slot === slot);
  if (!choice) return { ok: false as const, error: "배송 시간(오전/오후)을 다시 선택해 주세요." };
  if (!choice.available) return { ok: false as const, error: `${choice.reason}. 배송일이나 배송 시간을 다시 골라 주세요.` };
  // 유예 시간 안에 들어온 주문도 차수는 실제 접수 시각 기준(늦으면 다음 차수)으로 기록
  const actual = slotChoices(rule, date, now).find((item) => item.slot === slot);
  const run = actual && actual.available ? actual.run : choice.run;
  return { ok: true as const, run, label: run > 0 ? `오후 ${run}차 배송` : choice.label };
}

export function deliveryText(slot: string, run: number) {
  if (slot === "PM") return run > 0 ? `오후 ${run}차` : "오후";
  if (slot === "AM") return "오전";
  return "";
}
