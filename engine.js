// 아이돌봄 비서 계산 엔진 (결정론: 같은 입력이면 항상 같은 결과)
// 브라우저(<script type="module">)와 Node(import) 양쪽에서 쓴다. 외부 라이브러리 없음.
//
// 입력 family 예시(가상 가족):
// {
//   travelMin: 20,                                   // 집과 직장·기관 사이 이동 여유(분)
//   parents: [{ name: "엄마", week: { mon: ["08:00","18:30"], ... } }],   // 집을 나서는 시각~집에 오는 시각
//   children: [{ name: "첫째", week: { mon: [["08:40","13:30"],["14:00","16:30"]], ... },
//                needFrom: "07:00", needTo: "20:00" }],                   // 기관(학교·학원)에 있는 구간, 돌봄을 따질 하루 범위
//   overrides: { "2026-12-24": { children: { "첫째": [["08:40","12:30"]] } } } // 가정통신문의 단축수업 등
// }

export const RULES = Object.freeze({
  slotMin: 30,        // 신청 단위(분)
  minBlockMin: 120,   // 1회 최소 이용시간(분)
  serviceStart: "06:00",
  serviceEnd: "22:00",
});

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
export const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// 구간 연산 (분 단위 [s,e) 배열)
function normalize(list) {
  const a = list.filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, e] of a) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
function subtract(base, cut) {
  let cur = normalize(base);
  for (const [cs, ce] of normalize(cut)) {
    const next = [];
    for (const [s, e] of cur) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    cur = next;
  }
  return cur;
}
function intersect(a, b) {
  const out = [];
  for (const [s1, e1] of normalize(a)) for (const [s2, e2] of normalize(b)) {
    const s = Math.max(s1, s2), e = Math.min(e1, e2);
    if (e > s) out.push([s, e]);
  }
  return normalize(out);
}

// 그달 날짜 목록(평일만 돌봄 대상, 주말·공휴일 표시)
export function monthDays(year, month, holidays = []) {
  const hs = new Set(holidays);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = iso(year, month, d);
    const dow = DOW[new Date(Date.UTC(year, month - 1, d)).getUTCDay()];
    const off = dow === "sat" || dow === "sun" || hs.has(date);
    days.push({ date, dow, off, holiday: hs.has(date) });
  }
  return days;
}

// 하루의 아이별 돌봄 공백 = 하루 범위 − 기관에 있는 시간 − 부모 중 누구라도 집에 있는 시간
export function dayGaps(family, day) {
  const travel = family.travelMin || 0;
  const ov = (family.overrides || {})[day.date] || {};
  // 부모가 집에 없는 구간(출근 전 이동 여유를 앞당기고 퇴근 후 이동 여유를 늦춤)
  const awayAll = family.parents.map((p) => {
    const w = (ov.parents && ov.parents[p.name]) || p.week[day.dow];
    if (!w) return []; // 그날 출근 안 함, 집에 있음
    return [[toMin(w[0]) - travel, toMin(w[1]) + travel]];
  });
  // 두 부모 모두 집에 없는 구간 = 교집합
  let bothAway = awayAll.length ? awayAll[0] : [];
  for (const a of awayAll.slice(1)) bothAway = intersect(bothAway, a);
  const out = {};
  for (const c of family.children) {
    const range = [[toMin(c.needFrom || "07:00"), toMin(c.needTo || "20:00")]];
    const inst = ((ov.children && ov.children[c.name]) || c.week[day.dow] || []).map(([s, e]) => [toMin(s), toMin(e)]);
    const atHome = subtract(range, inst);
    out[c.name] = intersect(atHome, bothAway);
  }
  return out;
}

// 공백 구간을 아이돌봄 신청 건으로: 30분 단위로 바깥으로 맞추고, 2시간 미만은 늘리고, 06~22시로 자름
// inst(기관에 있는 구간, 분)를 주면 2시간을 채울 때 기관 시간 쪽으로 늘리지 않는다:
// 등원 직전 공백은 앞으로(더 이른 시각으로), 그 밖은 뒤로(더 늦은 시각으로) 늘린다.
export function toBlocks(gaps, rules = RULES, inst = []) {
  const slot = rules.slotMin, minB = rules.minBlockMin;
  const s0 = toMin(rules.serviceStart), e0 = toMin(rules.serviceEnd);
  let blocks = gaps.map(([gs, ge]) => [Math.floor(gs / slot) * slot, Math.ceil(ge / slot) * slot, ge]);
  blocks = blocks.map(([s, e, rawEnd]) => {
    s = Math.max(s, s0); e = Math.min(e, e0);
    if (e - s < minB) {
      const need = minB - (e - s);
      const beforeInst = inst.some(([is]) => is === rawEnd); // 공백이 기관 시작에서 끝남 = 등원 전
      if (beforeInst && s - need >= s0) s -= need;
      else if (e + need <= e0) e += need;
      else { s = Math.max(s0, s - (need - (e0 - e))); e = e0; }
    }
    return [s, e];
  });
  return normalize(blocks);
}

// 한 달 신청표 추천
export function recommend(family, year, month, holidays = [], rules = RULES) {
  const rows = [];
  for (const day of monthDays(year, month, holidays)) {
    if (day.off) continue;
    const gaps = dayGaps(family, day);
    const perChild = {};
    // 기관과 기관 사이의 짧은 공백(기본 60분 미만, 예: 학교에서 학원으로 걸어가는 시간)은 신청하지 않는다.
    // 등원 전·하원 후 공백은 짧아도 아이 혼자 있게 되므로 항상 신청한다.
    const ignore = family.ignoreGapMin ?? 60;
    const ov = (family.overrides || {})[day.date] || {};
    for (const c of family.children) {
      const inst = ((ov.children && ov.children[c.name]) || c.week[day.dow] || []).map(([s, e]) => [toMin(s), toMin(e)]);
      const between = ([s, e]) => inst.some(([, ie]) => ie === s) && inst.some(([is]) => is === e);
      perChild[c.name] = toBlocks(gaps[c.name].filter((g) => !(between(g) && g[1] - g[0] < ignore)), rules, inst);
    }
    for (const c of family.children) for (const [s, e] of perChild[c.name]) {
      // 동시돌봄: 다른 아이 신청과 겹치는 시간
      const others = family.children.filter((o) => o.name !== c.name).flatMap((o) => perChild[o.name]);
      const together = intersect([[s, e]], others);
      rows.push({ date: day.date, dow: day.dow, child: c.name, start: toHM(s), end: toHM(e), minutes: e - s,
        together: together.map(([a, b]) => `${toHM(a)}~${toHM(b)}`) });
    }
  }
  rows.sort((a, b) => (a.date + a.start + a.child).localeCompare(b.date + b.start + b.child));
  const summary = {
    applications: rows.length,
    days: new Set(rows.map((r) => r.date)).size,
    hoursByChild: Object.fromEntries(family.children.map((c) => [c.name, rows.filter((r) => r.child === c.name).reduce((t, r) => t + r.minutes, 0) / 60])),
  };
  return { rows, summary };
}

// 예상 본인부담금(시간당 금액은 rates 데이터에서: 정부지원 유형·아동 수에 따라 다르므로 '예상')
export function estimateFee(rows, hourlyByChild) {
  let total = 0;
  const byChild = {};
  for (const r of rows) {
    const h = r.minutes / 60, rate = hourlyByChild[r.child] || 0;
    byChild[r.child] = (byChild[r.child] || 0) + Math.round(h * rate);
    total += Math.round(h * rate);
  }
  return { total, byChild };
}

// 부부 공유 캘린더(.ics) 문자열
export function toICS(rows, title = "아이돌봄") {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//idolbom-secretary//KO", "CALSCALE:GREGORIAN"];
  for (const r of rows) {
    const d = r.date.replace(/-/g, "");
    L.push("BEGIN:VEVENT", `UID:${d}-${r.start.replace(":", "")}-${encodeURIComponent(r.child)}@idolbom-secretary`,
      `DTSTART;TZID=Asia/Seoul:${d}T${r.start.replace(":", "")}00`, `DTEND;TZID=Asia/Seoul:${d}T${r.end.replace(":", "")}00`,
      `SUMMARY:${title} ${r.child} ${r.start}-${r.end}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n");
}
