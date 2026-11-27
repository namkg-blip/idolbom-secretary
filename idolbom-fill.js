// 아이돌봄 누리집 정기신청 입력 도우미
// 쓰는 곳: 부모가 직접 로그인한 아이돌봄 누리집 정기신청 1단계 화면(달력이 보이는 화면)
// 하는 일: 아이돌봄 비서가 만든 신청표(idolbom-plan.json)의 날짜마다 달력 칸을 열고, 아이를 고르고,
//          시작과 끝 시각을 넣고, 일정추가를 누른다. 한 묶음(기본 15건, 누리집 권고)을 넣으면 임시저장을 누른다.
// 하지 않는 일: 로그인, 본인인증, 다음, 신청서 제출. 제출은 부모가 신청 내역을 보고 직접 누른다.
//              누리집의 다른 정보를 읽어 가거나 어디로 보내지 않는다.
//
// 사용: idolbomFill(plan, { dryRun: true })  창을 열고 값만 넣어 본 뒤 취소(아무것도 추가하지 않음)
//       idolbomFill(plan)                    일정추가 15건 후 임시저장(누리집이 새로 고쳐짐)
//       idolbomFill()                        새로 고쳐진 화면에서 남은 건을 이어서(이 탭에 남긴 진행 상황 사용)
//       idolbomFill.status()                 지금까지 넣은 건, 실패한 건, 남은 건
// 아이 연결: 신청표의 아이 이름이 누리집 아동 이름과 같으면 이름으로, 아니면 신청표에 처음 나온 순서대로
//           누리집 아동 순서에 맞춘다. 다르면 options.childMap = { "첫째": 0, "둘째": 1 } 로 지정.
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visibleLayer = () =>
    [...document.querySelectorAll(".layer-wrap")].find((w) => {
      const b = w.querySelector("#apply-btn");
      return b && b.offsetParent !== null;
    });

  // 실행 중에는 누리집 알림창을 띄우는 대신 내용을 기록해 결과에 남긴다(중복 신청 안내 등). 확인 질문에는 모두 아니오
  function watchDialogs(log) {
    const origAlert = window.alert, origConfirm = window.confirm;
    window.alert = (m) => { log.push({ alert: String(m) }); };
    window.confirm = (m) => { log.push({ confirm: String(m), answer: false }); return false; };
    return () => { window.alert = origAlert; window.confirm = origConfirm; };
  }

  async function openDay(iso) {
    const td = document.querySelector(`td.fc-day[data-date="${iso}"]`);
    if (!td) return { error: "달력에 없는 날짜(다른 달이면 달력을 그 달로 넘겨 주세요)" };
    if (td.classList.contains("fc-day-disabled")) return { error: "신청할 수 없는 날짜" };
    td.scrollIntoView({ block: "center" });
    await sleep(300);
    const r = td.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height * 0.6;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !td.contains(hit)) return { error: "다른 창이 달력을 가리고 있음(안내 창을 닫아 주세요)" };
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
    hit.dispatchEvent(new MouseEvent("mousedown", { ...o, buttons: 1 }));
    await sleep(30);
    document.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const w = visibleLayer();
      if (w) {
        const shown = (w.querySelector("input[type=text][readonly]") || {}).value;
        if (shown !== iso) { cancel(w); return { error: `창의 날짜(${shown})가 신청 날짜와 다름` }; }
        return { layer: w };
      }
    }
    return { error: "입력 창이 열리지 않음" };
  }

  function cancel(w) {
    const b = [...w.querySelectorAll("button")].find((x) => x.textContent.trim() === "취소");
    if (b) b.click();
  }

  function sections(w) {
    return [...w.querySelectorAll('input[data-id^="selectChild-"]')].map((cb) => {
      let sec = cb.parentElement;
      while (sec && !sec.querySelector('input[id^="service-pattern-"]')) sec = sec.parentElement;
      const label = (cb.closest("label") || cb.parentElement).textContent.replace(/\s+/g, " ").trim();
      return { cb, sec, label };
    });
  }

  function uncheck(sec) {
    for (const p of sec.sec.querySelectorAll('input[id^="service-pattern-"]')) if (p.checked) p.click();
    if (sec.cb.checked) sec.cb.click();
  }

  function setSelect(sel, value) {
    if (![...sel.options].some((o) => o.value === value)) return false;
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return sel.value === value;
  }

  async function fillRow(sec, row) {
    if (!sec.cb.checked) { sec.cb.click(); await sleep(150); }
    const pat = sec.sec.querySelector('input[id^="service-pattern-"]');
    if (!pat) return "이 아이의 돌봄 패턴이 누리집에 없음";
    if (!pat.checked) { pat.click(); await sleep(150); }
    const ss = [...pat.closest("tbody").querySelectorAll("select")];
    // 순서: 서비스 유형, 시작 시각, 종료일(당일/익일), 종료 시각, 정부지원 시간(누리집이 다시 계산)
    if (ss.length < 4) return "입력 칸 구조가 예상과 다름";
    // 누리집은 시작 시각을 바꿀 때 끝 시각이 더 이르면 종료일을 익일로 바꾼다. 그래서 끝 시각을 먼저 넣고 시작 시각을 넣은 뒤 종료일을 당일로 맞춘다
    if (!setSelect(ss[3], row.end)) return `끝 시각 ${row.end} 선택지 없음`;
    if (!setSelect(ss[1], row.start)) return `시작 시각 ${row.start} 선택지 없음`;
    if (ss[2].value !== "today" && !setSelect(ss[2], "today")) return "종료일을 당일로 맞추지 못함";
    await sleep(200);
    if (ss[1].value !== row.start || ss[3].value !== row.end || ss[2].value !== "today") return "넣은 값이 누리집에서 바뀜";
    row._seen = `${ss[1].value}~${ss[3].value} 정부지원 ${ss[4] ? ss[4].value : ""}`;
    return null;
  }

  const KEY = "idolbomFill.state"; // 진행 상황은 이 탭의 sessionStorage 에만 둔다(탭을 닫으면 사라짐)
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } };
  const keep = (st) => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 저장 못 하면 결과로만 알림 */ } };

  function saveTemp(log) {
    const b = document.querySelector("#temporary-save-btn");
    if (!b) return "임시저장 버튼을 찾지 못함";
    window.confirm = (m) => { log.push({ confirm: String(m), answer: true }); return true; }; // 임시저장 확인 질문에만 예
    b.click();
    return null;
  }

  window.idolbomFill = async function (plan, options = {}) {
    const prev = plan ? null : load();
    if (!plan && !prev) return { error: "신청표가 없음. idolbomFill(신청표) 로 시작해 주세요" };
    const opt = prev ? prev.options : options;
    const { dryRun = false, max = 15, childMap = {} } = opt;
    const rows = prev ? prev.rest : (plan.rows || plan).slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const order = prev ? prev.order : [...new Set(rows.map((r) => r.child))];
    const st = prev || { options: { dryRun, max, childMap }, order, saved: [], failed: [], rounds: 0 };
    if (!rows.length) return { finished: true, saved: st.saved.length, failed: st.failed, next: "부모가 다음, 신청서 제출을 직접 누릅니다" };
    const log = [], done = [], failed = [];
    let stopped = null;
    const restore = watchDialogs(log);
    try {
      const pending = rows.slice();
      while (pending.length && done.length < max) {
        const date = pending[0].date;
        // 같은 아이는 창 한 번에 한 건만 들어가므로, 날짜마다 아이별로 한 건씩 골라 창을 연다
        const pick = [];
        for (const r of pending) if (r.date === date && !pick.some((p) => p.child === r.child)) pick.push(r);
        const batch = pick.slice(0, max - done.length);
        const opened = await openDay(date);
        if (opened.error) {
          for (const r of batch) { failed.push({ ...r, why: opened.error }); pending.splice(pending.indexOf(r), 1); }
          continue;
        }
        const w = opened.layer, secs = sections(w);
        const ok = [];
        for (const r of batch) {
          const fi = secs.findIndex((s) => s.label.includes(r.child));
          const idx = r.child in childMap ? childMap[r.child] : fi >= 0 ? fi : order.indexOf(r.child);
          const sec = secs[idx];
          const why = sec ? await fillRow(sec, r) : "누리집에서 이 아이를 찾지 못함";
          const seen = r._seen;
          delete r._seen;
          if (why && sec) uncheck(sec); // 실패한 건이 체크된 채 일정추가에 섞이지 않도록 되돌림
          if (why) failed.push({ ...r, why }); else ok.push({ ...r, filled: seen });
          pending.splice(pending.indexOf(r), 1);
        }
        const checkedNow = w.querySelectorAll('input[id^="service-pattern-"]:checked').length;
        if (dryRun || !ok.length) { cancel(w); done.push(...ok.map((r) => ({ ...r, dryRun, checkedInWindow: checkedNow }))); await sleep(400); continue; }
        if (checkedNow !== ok.length) { // 넣으려는 건수와 체크된 건수가 다르면 추가하지 않고 멈춤
          cancel(w);
          pending.unshift(...ok.map(({ filled, ...r }) => r));
          stopped = `체크된 건수(${checkedNow})가 넣을 건수(${ok.length})와 달라 멈춤`;
          break;
        }
        const before = log.length;
        w.querySelector("#apply-btn").click();
        await sleep(1200);
        const msgs = log.slice(before).map((m) => m.alert || m.confirm);
        if (visibleLayer()) { cancel(visibleLayer()); for (const r of ok) failed.push({ ...r, why: msgs.join(" / ") || "일정추가 후 창이 닫히지 않음" }); }
        else done.push(...ok.map((r) => ({ ...r, note: msgs.join(" / ") })));
        await sleep(400);
      }
      const result = { dryRun, added: dryRun ? 0 : done.length, checked: done.length, failed, left: pending.length, stopped, done, dialogs: log };
      if (dryRun) return result;
      st.saved.push(...done); st.failed.push(...failed); st.rest = pending; st.rounds += 1; st.last = result;
      if (!done.length || stopped) { keep(st); return { ...result, next: stopped ? "화면을 확인한 뒤 idolbomFill() 로 다시 이어서" : "넣은 건이 없어 임시저장하지 않음" }; }
      keep(st); // 임시저장 뒤 화면이 새로 고쳐지므로 진행 상황을 먼저 남긴다
      const err = saveTemp(log);
      if (err) return { ...result, error: err };
      return { ...result, saving: true, next: pending.length ? "임시저장 뒤 화면이 새로 고쳐지면 idolbomFill() 로 남은 건을 이어서" : "모두 임시저장. 부모가 다음, 신청서 제출을 직접 누릅니다" };
    } finally { setTimeout(restore, 3000); } // 임시저장 확인 질문이 늦게 떠도 예가 되도록 잠시 둔 뒤 원래대로
  };

  window.idolbomFill.status = () => {
    const st = load();
    return st ? { rounds: st.rounds, saved: st.saved.length, failed: st.failed, left: (st.rest || []).length } : { none: true };
  };
  window.idolbomFill.reset = () => { try { sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ } return "진행 상황을 지움"; };
})();
