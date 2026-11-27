import { recommend, estimateFee, toICS } from "./engine.js";
import { parseNotice, reminders, toOverrides } from "./notice.js";

const DAYS = [["mon", "월"], ["tue", "화"], ["wed", "수"], ["thu", "목"], ["fri", "금"]];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 예시 가족(가상): 부부 08:30 근무 시작, 엄마 17:30 끝, 아빠 19:00 끝. 첫째 초등 2학년, 둘째 7세 유치원
const SAMPLE = {
  parents: [
    { name: "엄마", start: "08:30", end: "17:30", days: ["mon", "tue", "wed", "thu", "fri"] },
    { name: "아빠", start: "08:30", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri"] },
  ],
  children: [
    { name: "첫째", needFrom: "07:00", needTo: "20:00", inst: { mon: "08:50-13:40, 14:00-16:00", tue: "08:50-14:30", wed: "08:50-13:40, 14:00-16:00", thu: "08:50-14:30", fri: "08:50-13:40" } },
    { name: "둘째", needFrom: "07:00", needTo: "20:00", inst: { mon: "09:00-16:30", tue: "09:00-16:30", wed: "09:00-16:30", thu: "09:00-16:30", fri: "09:00-16:30" } },
  ],
};

let state = load() || structuredClone(SAMPLE);
let overrides = {};
let lastPlan = null;

function load() { try { return JSON.parse(localStorage.getItem("idolbom-family")); } catch { return null; } }
function save() { try { localStorage.setItem("idolbom-family", JSON.stringify(state)); } catch { /* 저장 못 해도 계산은 됨 */ } }

function renderParents() {
  const t = $("parentsTbl");
  t.innerHTML = `<tr><th>이름</th><th>근무 시작</th><th>근무 끝</th><th>근무 요일</th><th></th></tr>` +
    state.parents.map((p, i) => `<tr>
      <td><input data-p="${i}" data-k="name" value="${esc(p.name)}"></td>
      <td><input type="time" data-p="${i}" data-k="start" value="${p.start}"></td>
      <td><input type="time" data-p="${i}" data-k="end" value="${p.end}"></td>
      <td>${DAYS.map(([d, k]) => `<label style="display:inline-flex;flex-direction:row;gap:2px"><input type="checkbox" data-p="${i}" data-day="${d}" ${p.days.includes(d) ? "checked" : ""}>${k}</label>`).join(" ")}</td>
      <td><button type="button" class="x" data-delp="${i}">빼기</button></td></tr>`).join("");
}
function renderChildren() {
  const t = $("childrenTbl");
  t.innerHTML = `<tr><th>이름</th><th>돌봄 볼 시간</th>${DAYS.map(([, k]) => `<th>${k}</th>`).join("")}<th></th></tr>` +
    state.children.map((c, i) => `<tr>
      <td><input data-c="${i}" data-k="name" value="${esc(c.name)}"></td>
      <td><input type="time" data-c="${i}" data-k="needFrom" value="${c.needFrom}"> ~ <input type="time" data-c="${i}" data-k="needTo" value="${c.needTo}"></td>
      ${DAYS.map(([d]) => `<td><input data-c="${i}" data-inst="${d}" value="${esc(c.inst[d] || "")}" placeholder="09:00-16:30"></td>`).join("")}
      <td><button type="button" class="x" data-delc="${i}">빼기</button></td></tr>`).join("");
  $("noticeChild").innerHTML = state.children.map((c) => `<option>${esc(c.name)}</option>`).join("");
}

document.addEventListener("input", (e) => {
  const el = e.target, d = el.dataset;
  if (d.p !== undefined) {
    const p = state.parents[+d.p];
    if (d.day) p.days = el.checked ? [...new Set([...p.days, d.day])] : p.days.filter((x) => x !== d.day);
    else p[d.k] = el.value;
  } else if (d.c !== undefined) {
    const c = state.children[+d.c];
    if (d.inst) c.inst[d.inst] = el.value; else c[d.k] = el.value;
    if (d.k === "name") renderChildrenSelectOnly();
  } else return;
  save();
});
function renderChildrenSelectOnly() { $("noticeChild").innerHTML = state.children.map((c) => `<option>${esc(c.name)}</option>`).join(""); }
document.addEventListener("click", (e) => {
  const d = e.target.dataset;
  if (d.delp !== undefined) { state.parents.splice(+d.delp, 1); save(); renderParents(); }
  if (d.delc !== undefined) { state.children.splice(+d.delc, 1); save(); renderChildren(); }
});
$("addParent").onclick = () => { state.parents.push({ name: "보호자", start: "09:00", end: "18:00", days: DAYS.map(([d]) => d) }); save(); renderParents(); };
$("addChild").onclick = () => { state.children.push({ name: "아이", needFrom: "07:00", needTo: "20:00", inst: {} }); save(); renderChildren(); };

const parseRanges = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("-").map((t) => t.trim()));

function toFamily() {
  return {
    travelMin: +$("travel").value || 0,
    ignoreGapMin: +$("ignoreGap").value || 0,
    parents: state.parents.map((p) => ({ name: p.name, week: Object.fromEntries(p.days.map((d) => [d, [p.start, p.end]])) })),
    children: state.children.map((c) => ({ name: c.name, needFrom: c.needFrom, needTo: c.needTo,
      week: Object.fromEntries(DAYS.map(([d]) => [d, parseRanges(c.inst[d])])) })),
    overrides,
  };
}

// 2. 가정통신문
$("parseNotice").onclick = () => {
  const [y, m] = ($("noticeMonth").value || "").split("-").map(Number);
  const child = $("noticeChild").value;
  const items = parseNotice($("noticeText").value, { year: y, month: m, child });
  const rem = reminders(items);
  const ov = toOverrides(items, toFamily());
  const box = $("noticeOut");
  if (!items.length) { box.innerHTML = `<p class="hint">뽑을 항목을 찾지 못했습니다. 날짜와 준비물, 제출 같은 말이 들어 있는지 확인해 주세요.</p>`; return; }
  box.innerHTML = `<h3>뽑은 항목 (확인 후 쓰세요)</h3><table><tr><th>날짜</th><th>종류</th><th>내용</th></tr>` +
    items.map((it) => `<tr><td>${it.date || "날짜 없음"}${it.until ? " ~ " + it.until : ""}${it.time ? " " + it.time : ""}</td><td><span class="tag k-${it.kind}">${it.kind}</span></td><td>${esc(it.text)}</td></tr>`).join("") +
    `</table><h3>미리 알림</h3><table><tr><th>알림 시각</th><th>내용</th></tr>` +
    rem.map((r) => `<tr><td>${r.at}</td><td>${r.item.kind === "제출" ? "제출 마감 " + r.item.date : r.item.kind + " " + r.item.date}: ${esc(r.item.text)}</td></tr>`).join("") + `</table>` +
    (Object.keys(ov).length ? `<p>등하원이 바뀌는 날 ${Object.keys(ov).join(", ")} 을(를) 신청표 계산에 반영했습니다.</p>` : "");
  Object.assign(overrides, ov);
};

// 3. 신청표
async function loadHolidays() {
  try {
    const h = await (await fetch("holidays.json")).json();
    $("holidays").value = h.dates.join(", ");
    $("holidayNote").textContent = `기본값 출처: ${h.source}. 확인이 필요한 날: ${h.check.join(", ")}`;
  } catch { $("holidayNote").textContent = "공휴일 기본값을 불러오지 못했습니다. 직접 넣어 주세요."; }
}
$("makePlan").onclick = () => {
  const [y, m] = ($("planMonth").value || "").split("-").map(Number);
  if (!y) return;
  const hol = $("holidays").value.split(",").map((s) => s.trim()).filter(Boolean);
  const fam = toFamily();
  lastPlan = recommend(fam, y, m, hol);
  const { rows, summary } = lastPlan;
  $("planSummary").innerHTML = `<div class="sum"><div>신청 건수<b>${summary.applications}건</b></div><div>신청 날짜<b>${summary.days}일</b></div>` +
    Object.entries(summary.hoursByChild).map(([k, v]) => `<div>${esc(k)} 돌봄<b>${v}시간</b></div>`).join("") +
    `<div>동시돌봄 건<b>${rows.filter((r) => r.together.length).length}건</b></div></div>`;
  $("planOut").innerHTML = `<table><tr><th>날짜</th><th>아이</th><th>시간</th><th>동시돌봄</th></tr>` +
    rows.map((r) => `<tr><td>${r.date} (${({ mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" })[r.dow]})</td><td>${esc(r.child)}</td><td>${r.start} ~ ${r.end}</td><td>${r.together.join(", ")}</td></tr>`).join("") + `</table>`;
  $("rateInputs").innerHTML = fam.children.map((c) => `<label>${esc(c.name)} 시간당 본인부담(원) <input type="number" min="0" step="10" data-rate="${esc(c.name)}"></label>`).join("");
  $("feeBox").hidden = false; $("downloads").hidden = false; $("feeOut").textContent = "";
  $("copyFill").disabled = false; $("dlFill").disabled = false; $("fillOut").textContent = "";
};
document.addEventListener("input", (e) => {
  if (!e.target.dataset.rate || !lastPlan) return;
  const rates = Object.fromEntries([...document.querySelectorAll("[data-rate]")].map((i) => [i.dataset.rate, +i.value || 0]));
  const f = estimateFee(lastPlan.rows, rates);
  $("feeOut").innerHTML = `<div class="sum"><div>예상 합계<b>${f.total.toLocaleString()}원</b></div>` +
    Object.entries(f.byChild).map(([k, v]) => `<div>${esc(k)}<b>${v.toLocaleString()}원</b></div>`).join("") + `</div>`;
});

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("dlIcs").onclick = () => lastPlan && download("idolbom.ics", toICS(lastPlan.rows), "text/calendar");
$("dlJson").onclick = () => lastPlan && download("idolbom-plan.json", JSON.stringify(lastPlan, null, 1), "application/json");
$("dlCsv").onclick = () => lastPlan && download("idolbom-plan.csv",
  "﻿날짜,아이,시작,끝,동시돌봄\n" + lastPlan.rows.map((r) => [r.date, r.child, r.start, r.end, r.together.join(" ")].join(",")).join("\n"), "text/csv");

// 누리집 입력 도우미: 도우미 코드 뒤에 이번 신청표를 붙여 한 번에 실행되게 만든다
async function fillScript() {
  const helper = await (await fetch("idolbom-fill.js")).text();
  const rows = lastPlan.rows.map(({ date, child, start, end }) => ({ date, child, start, end }));
  return `${helper}\nidolbomFill(${JSON.stringify({ rows })}).then((r) => console.log(r));\n`;
}
$("copyFill").onclick = async () => {
  if (!lastPlan) return;
  const text = await fillScript();
  try { await navigator.clipboard.writeText(text); $("fillOut").textContent = `신청 ${lastPlan.rows.length}건이 담긴 도우미를 복사했습니다. 누리집 정기신청 화면의 Console에 붙여 넣으세요.`; }
  catch (e) { download("idolbom-fill.js", text, "text/javascript"); $("fillOut").textContent = "복사가 막혀 파일로 내려받았습니다. 파일 내용을 Console에 붙여 넣으세요."; }
};
$("dlFill").onclick = async () => lastPlan && download("idolbom-fill.js", await fillScript(), "text/javascript");

// 시작
const now = new Date();
const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
$("planMonth").value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
$("noticeMonth").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
renderParents(); renderChildren(); loadHolidays();
