import assert from "node:assert/strict";
import { parseNotice, reminders, toOverrides } from "./notice.js";

const text = `2학년 12월 가정통신문
1. 12월 10일(목) 겨울 숲 체험학습이 있습니다. 준비물: 도시락, 물통, 여벌 옷
2. 체험학습 참가 동의서는 12월 4일(금)까지 제출해 주세요.
3. 12월 24일(목)은 단축수업으로 12시 30분에 하교합니다.
4. 겨울방학은 2027. 1. 8.(금)부터 2027. 2. 28.(일)까지입니다.`;

const items = parseNotice(text, { year: 2026, month: 12, child: "첫째" });
const kinds = items.map((i) => `${i.kind}:${i.date}`);
assert.ok(kinds.includes("준비물:2026-12-10") || kinds.includes("행사:2026-12-10"), kinds.join());
assert.ok(kinds.includes("제출:2026-12-04"), kinds.join());
const early = items.find((i) => i.kind === "등하원변경" && i.date === "2026-12-24");
assert.equal(early.time, "12:30");
const vac = items.find((i) => i.text.includes("방학"));
assert.equal(vac.date, "2027-01-08");
assert.equal(vac.until, "2027-02-28");

const rem = reminders(items);
assert.ok(rem.some((r) => r.at === "2026-12-02 19:00" && r.item.kind === "제출"));

const W = (v) => ({ mon: v, tue: v, wed: v, thu: v, fri: v });
const fam = { children: [{ name: "첫째", week: W([["09:00", "13:30"], ["14:00", "16:30"]]) }] };
assert.deepEqual(toOverrides(items, fam)["2026-12-24"].children["첫째"], [["09:00", "12:30"]]);

// 결정론
assert.equal(JSON.stringify(parseNotice(text, { year: 2026, month: 12, child: "첫째" })), JSON.stringify(items));
console.log("OK", items.length, "items,", rem.length, "reminders");
