// node app/test/engine.test.mjs: 계산 엔진 시험(같은 입력 같은 결과 확인 포함)
import assert from "node:assert/strict";
import { recommend, dayGaps, toBlocks, monthDays, toMin, toICS } from "./engine.js";

const W = (v) => ({ mon: v, tue: v, wed: v, thu: v, fri: v });
// 가상 가족: 부모 둘 다 08:00 출근(07:40 집 나섬) 19:00 퇴근(19:20 도착)
const family = {
  travelMin: 20,
  parents: [{ name: "엄마", week: W(["08:00", "19:00"]) }, { name: "아빠", week: W(["08:00", "19:00"]) }],
  children: [
    { name: "첫째", needFrom: "07:00", needTo: "20:00", week: W([["09:00", "13:30"], ["14:00", "16:30"]]) },
    { name: "둘째", needFrom: "07:00", needTo: "20:00", week: W([["09:00", "16:30"]]) },
  ],
  overrides: { "2026-12-24": { children: { "둘째": [["09:00", "12:30"]] } } },
};
const holidays = ["2026-12-25"];

// 1) 달력: 2026-12 평일 22일(12/25 제외)
const days = monthDays(2026, 12, holidays).filter((d) => !d.off);
assert.equal(days.length, 22);

// 2) 하루 공백: 첫째 07:40~09:00, 13:30~14:00, 16:30~19:20
const g = dayGaps(family, { date: "2026-12-01", dow: "tue" });
assert.deepEqual(g["첫째"], [[toMin("07:40"), toMin("09:00")], [toMin("13:30"), toMin("14:00")], [toMin("16:30"), toMin("19:20")]]);

// 3) 신청 블록: 2시간 최소·30분 단위: 07:30~09:30, 13:30~15:30(30분 공백도 2h), 16:30~19:30
assert.deepEqual(toBlocks(g["첫째"]), [[450, 570], [810, 930], [990, 1170]]); // inst 미지정 시 뒤로 늘림

// 4) 한 달 추천 + 단축수업 반영 + 동시돌봄
const r1 = recommend(family, 2026, 12, holidays);
const xmasEve = r1.rows.filter((r) => r.date === "2026-12-24" && r.child === "둘째");
assert.ok(xmasEve.some((r) => r.start === "12:30"), "단축수업 하원 12:30 반영");
assert.ok(r1.rows.some((r) => r.together.length), "동시돌봄 표시");

// 4-1) 60분 미만 공백(13:30~14:00 학교에서 학원)은 신청에서 빠짐
assert.ok(!r1.rows.some((r) => r.date === "2026-12-01" && r.child === "첫째" && r.start === "13:30"), "짧은 공백 제외");
assert.ok(r1.rows.some((r) => r.date === "2026-12-01" && r.child === "첫째" && r.start === "07:00" && r.end === "09:00"), "등원 전 공백은 이른 쪽으로 2시간");;

// 4-2) 등원 전 짧은 공백(40분)은 무시하지 않는다: 부모 08:10 출발, 등교 08:50
const fam2 = { travelMin: 20, parents: [{ name: "엄마", week: W(["08:30", "17:30"]) }],
  children: [{ name: "첫째", needFrom: "07:00", needTo: "20:00", week: W([["08:50", "16:00"]]) }] };
const r3 = recommend(fam2, 2026, 12, holidays);
assert.ok(r3.rows.some((r) => r.date === "2026-12-01" && r.start === "07:00" && r.end === "09:00"), "등원 전 40분도 신청, 2시간은 이른 쪽으로 채움(07:00~09:00)");

// 5) 결정론: 같은 입력 두 번이면 완전히 같은 결과
const r2 = recommend(JSON.parse(JSON.stringify(family)), 2026, 12, holidays);
assert.equal(JSON.stringify(r1), JSON.stringify(r2));

// 6) ics 생성
assert.ok(toICS(r1.rows).includes("BEGIN:VEVENT"));
console.log("OK", r1.summary);
