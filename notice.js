// 가정통신문에서 준비물·제출·행사·등하원 변경 항목 (규칙 기반, 같은 글이면 같은 결과)
// 대화형 에이전트가 먼저 정리해 줄 수도 있지만, 최종 날짜·분류는 이 규칙으로 다시 맞춰 확인한다.

const KINDS = [
  ["등하원변경", /단축\s?수업|조기\s?하교|하교\s?시간|하원\s?시간|휴업|휴원|재량\s?휴|방학|개학|등교\s?시간\s?변경|원격\s?수업/],
  ["제출", /제출|회신|동의서|신청서|참가비|납부|입금|서명|확인서|가정\s?통신\s?문\s?회신/],
  ["준비물", /준비물|지참|가져\s?오|챙겨|착용|복장|도시락|물통|개인\s?컵|여벌|실내화|수저/],
  ["행사", /행사|발표회|참관|체험\s?학습|현장\s?학습|소풍|졸업|입학|운동회|공연|축제|상담/],
];

const pad = (n) => String(n).padStart(2, "0");

// 날짜 표현 찾기: 2026. 12. 24. / 12월 24일 / 12/24 / 12.24.
function findDates(line, baseYear, baseMonth) {
  // 목록 번호('1. 12월 10일')를 날짜로 오인하지 않도록 형식을 명시적으로 나눠 찾는다
  const pats = [
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,        // 2027년 1월 8일
    /(20\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/g,       // 2027. 1. 8.
    /()(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,                 // 12월 24일
    /()(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d/])/g,               // 12/24
    /()(?<![\d.\s])(\d{1,2})\.(\d{1,2})\.(?!\d)/g,              // 12.24.
  ];
  const out = [], taken = [];
  for (const re of pats) {
    let m;
    while ((m = re.exec(line))) {
      const s = m.index, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      let y = m[1] ? +m[1] : baseYear;
      if (!m[1] && mo < baseMonth - 6) y += 1; // 12월에 받은 통신문의 1월 날짜는 다음 해
      taken.push([s, e]);
      out.push({ date: `${y}-${pad(mo)}-${pad(d)}`, at: s });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// 시각: 12:30 / 12시 30분 / 오후 1시
function findTime(line) {
  let m = line.match(/(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{2})?\s*분?/);
  if (!m) return null;
  let h = +m[2];
  const mi = m[3] ? +m[3] : 0;
  if (m[1] === "오후" && h < 12) h += 12;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

export function parseNotice(text, { year, month, child = "" } = {}) {
  const items = [];
  // 줄바꿈과 한국어 문장 끝('~다.', '~요.')에서만 나눈다. '2027. 1. 8.' 같은 날짜의 마침표는 자르지 않음
  const lines = text.split(/\r?\n|(?<=[다요]\.)\s+/).map((s) => s.trim()).filter(Boolean);
  let lastDate = null;
  for (const line of lines) {
    const dates = findDates(line, year, month);
    if (dates.length) lastDate = dates[0].date;
    const kind = (KINDS.find(([, re]) => re.test(line)) || [])[0];
    if (!kind) continue;
    const date = dates.length ? dates[0].date : lastDate; // 날짜 없는 준비물 줄은 바로 앞 날짜에 붙임
    items.push({ child, kind, date, until: dates[1] ? dates[1].date : null, time: kind === "등하원변경" ? findTime(line) : null, text: line });
  }
  return items;
}

// 알림 일정: 준비물·행사 = 전날 19:00 + 당일 07:30, 제출 = 이틀 전 19:00 + 전날 19:00
export function reminders(items) {
  const shift = (iso, d) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const out = [];
  for (const it of items) {
    if (!it.date) continue;
    if (it.kind === "제출") out.push({ at: `${shift(it.date, -2)} 19:00`, item: it }, { at: `${shift(it.date, -1)} 19:00`, item: it });
    else if (it.kind === "준비물" || it.kind === "행사") out.push({ at: `${shift(it.date, -1)} 19:00`, item: it }, { at: `${it.date} 07:30`, item: it });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// 등하원 변경 항목을 엔진 overrides 로 (하원이 앞당겨지는 경우만 자동, 나머지는 부모 확인)
export function toOverrides(items, family) {
  const ov = {};
  for (const it of items) {
    if (it.kind !== "등하원변경" || !it.date || !it.time || !it.child) continue;
    const c = family.children.find((x) => x.name === it.child);
    if (!c) continue;
    const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(it.date + "T00:00:00Z").getUTCDay()];
    const day = c.week[dow];
    if (!day || !day.length) continue;
    const first = day[0];
    ov[it.date] = ov[it.date] || { children: {} };
    ov[it.date].children[c.name] = [[first[0], it.time]]; // 첫 기관 하원을 앞당기고 이후 학원 등은 부모가 확인
  }
  return ov;
}
