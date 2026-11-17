// 参加者タブ: 誰が何に参加するかを色と表示で一目で分かるようにし、追加・編集する
(function (global) {
  "use strict";

  const { el, yen, newId, toast, openForm } = global.TakopaUI;
  const calc = global.TakopaCalc;

  const CATEGORY_LABEL = { univ: "大学生以上", high: "高校生" };
  const STATUS_LABEL = { red: "宿泊確定", green: "たこパ確定", blue: "未確定", gray: "キャンセル" };

  function countLabel(counts) {
    const total = counts.univ + counts.high;
    return `${total}人（大${counts.univ}・高${counts.high}）`;
  }

  function summary(data, accounting) {
    const people = data.participants;
    const takoCounts = {
      univ: accounting.counts.takoStay.univ + accounting.counts.takoOnly.univ,
      high: accounting.counts.takoStay.high + accounting.counts.takoOnly.high,
    };
    const maybe = people.filter((p) => p.status === "maybe").length;
    const cancelled = people.filter((p) => p.status === "cancelled").length;
    return el("section", { class: "card summary" }, [
      el("h2", { class: "card-title", text: "確定している人数" }),
      el("dl", { class: "summary-grid" }, [
        el("dt", { text: "11日 宿泊" }), el("dd", { text: countLabel(accounting.counts.stay11) }),
        el("dt", { text: "12日 宿泊" }), el("dd", { text: countLabel(accounting.counts.stay12) }),
        el("dt", { text: "たこパ（11日）" }), el("dd", { text: countLabel(takoCounts) }),
        el("dt", { text: "未確定" }), el("dd", { text: `${maybe}人` }),
        el("dt", { text: "キャンセル" }), el("dd", { text: `${cancelled}人` }),
      ]),
      el("ul", { class: "legend", "aria-label": "色の意味" }, Object.entries(STATUS_LABEL).map(([color, label]) =>
        el("li", { class: `legend-item color-${color}` }, [el("span", { class: "legend-swatch" }), label]))),
    ]);
  }

  function chips(person) {
    const list = [];
    if (person.stay11) list.push("11日泊");
    if (person.stay12) list.push("12日泊");
    if (calc.joinsTako(person)) list.push(person.stay11 ? "🐙たこパ" : "🐙たこパのみ");
    if (person.sweets) list.push("🍰スイーツ");
    if (!list.length) list.push("参加なし");
    return el("span", { class: "chips" }, list.map((text) => el("span", { class: "chip", text })));
  }

  function row(person, entry, ctx) {
    const color = calc.statusColor(person);
    const detail = [person.grade, person.note].filter(Boolean).join("・");
    return el("li", {}, el("button", {
      type: "button",
      class: `person color-${color}`,
      dataset: { id: person.id },
      onclick: () => editPerson(person, ctx),
    }, [
      el("span", { class: "person-main" }, [
        el("span", { class: "person-name" }, [
          person.name,
          person.organizer ? el("span", { class: "badge", text: "主催" }) : null,
        ]),
        el("span", { class: "person-status", text: STATUS_LABEL[color] }),
        chips(person),
        detail ? el("span", { class: "person-detail", text: detail }) : null,
      ]),
      el("span", { class: "person-money" }, [
        el("span", { class: "person-due", text: entry.due > 0 ? yen(entry.due) : "—" }),
        entry.due > 0 ? el("span", { class: person.paid ? "paid is-paid" : "paid", text: person.paid ? "支払い済" : "未払い" }) : null,
      ]),
    ]));
  }

  const FIELDS = [
    { key: "name", label: "名前", type: "text" },
    { key: "category", label: "区分", type: "choice", options: [{ value: "univ", label: "大学生以上" }, { value: "high", label: "高校生" }],
      hint: "社会人は大学生以上。高専1〜3年は高校生、4〜5年は大学生以上" },
    { key: "status", label: "状態", type: "choice", options: [{ value: "confirmed", label: "確定" }, { value: "maybe", label: "未確定" }, { value: "cancelled", label: "キャンセル" }] },
    { key: "stay11", label: "11日 宿泊", type: "checkbox", hint: "11日に泊まる人は自動でたこパにも参加します" },
    { key: "stay12", label: "12日 宿泊", type: "checkbox" },
    { key: "takoOnly", label: "たこパのみ参加（11日）", type: "checkbox", disabled: (s) => Boolean(s.stay11),
      hint: "11日に泊まる人は自動でたこパ参加になるため、ここは押せません" },
    { key: "sweets", label: "🍰 スイーツ参加", type: "checkbox" },
    { key: "cancelFee", label: "キャンセル料あり（7日前以降。固定料金の50%）", type: "checkbox", show: (s) => s.status === "cancelled" },
    { key: "paid", label: "支払い済み", type: "checkbox" },
    { key: "organizer", label: "主催者（余りが出たら宿泊費1泊分が無料）", type: "checkbox" },
    { key: "gender", label: "性別", type: "text" },
    { key: "age", label: "年齢", type: "text" },
    { key: "term", label: "派遣期", type: "text" },
    { key: "grade", label: "学年", type: "text" },
    { key: "ig", label: "IG", type: "text" },
    { key: "note", label: "備考", type: "textarea", rows: 3 },
  ];

  function blankPerson() {
    return {
      id: newId("p"), name: "", category: "high", status: "maybe",
      stay11: false, stay12: false, takoOnly: false, sweets: false,
      organizer: false, paid: false, cancelFee: false,
      gender: "", age: "", term: "", grade: "", ig: "", note: "",
    };
  }

  function normalize(values) {
    const person = Object.assign({}, values, { name: (values.name || "").trim() });
    if (person.stay11) person.takoOnly = false; // 11日泊は自動でたこパ参加
    if (person.status !== "cancelled") person.cancelFee = false;
    return person;
  }

  function editPerson(person, ctx) {
    openForm({
      title: `${person.name} を編集`,
      fields: FIELDS,
      values: person,
      onSubmit: (values) => {
        const next = normalize(values);
        if (!next.name) return "名前を入力してください";
        ctx.update((data) => {
          const index = data.participants.findIndex((p) => p.id === person.id);
          if (index >= 0) data.participants[index] = next;
        });
        return null;
      },
      onDelete: () => {
        let removedIndex = -1;
        ctx.update((data) => {
          removedIndex = data.participants.findIndex((p) => p.id === person.id);
          if (removedIndex >= 0) data.participants.splice(removedIndex, 1);
        });
        toast(`${person.name} を削除しました`, () => ctx.update((data) => {
          data.participants.splice(Math.max(0, removedIndex), 0, person);
        }));
      },
    });
  }

  function addPerson(ctx) {
    openForm({
      title: "参加者を追加",
      fields: FIELDS,
      values: blankPerson(),
      submitLabel: "追加",
      onSubmit: (values) => {
        const next = normalize(values);
        if (!next.name) return "名前を入力してください";
        ctx.update((data) => { data.participants.push(next); });
        toast(`${next.name} を追加しました`);
        return null;
      },
    });
  }

  function render(container, data, ctx) {
    const accounting = calc.computeAccounting(data, {});
    const sections = ["univ", "high"].map((category) => {
      const people = data.participants.filter((p) => p.category === category);
      return el("section", { class: "card" }, [
        el("h2", { class: "card-title", text: `${CATEGORY_LABEL[category]}（${people.length}人）` }),
        people.length
          ? el("ul", { class: "person-list" }, people.map((p) => row(p, accounting.perPerson[p.id], ctx)))
          : el("p", { class: "empty", text: "まだいません" }),
      ]);
    });
    container.replaceChildren(
      summary(data, accounting),
      el("button", { type: "button", class: "button button-primary button-block", id: "add-person", text: "＋ 参加者を追加", onclick: () => addPerson(ctx) }),
      ...sections,
      el("p", { class: "field-hint", text: "金額は確定した人の請求額（割り勘・割引込み）。押すと編集できます。" }),
    );
  }

  global.TakopaViews = Object.assign(global.TakopaViews || {}, { participants: render });
})(window);
