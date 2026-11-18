// 会計タブ: 料金設定、区分ごとの人数と小計、費用、収支（不足の割り勘・余りの配分）、集金
(function (global) {
  "use strict";

  const { el, yen, newId, toast, openForm } = global.TakopaUI;
  const calc = global.TakopaCalc;

  const PRICE_ROWS = [
    { kind: "stay", label: "宿泊（1泊）" },
    { kind: "tako", label: "たこパのみ" },
    { kind: "takoStay", label: "宿泊者のたこパ" },
    { kind: "sweets", label: "🍰 スイーツ" },
  ];
  const EXPENSE_KINDS = [
    { value: "venue", label: "会場代" },
    { value: "food", label: "食費" },
    { value: "other", label: "その他" },
  ];

  let includeMaybe = false; // 画面の表示状態（データには保存しない）

  function priceTable(data, ctx) {
    const input = (kind, category) => {
      const field = el("input", {
        type: "number", inputmode: "numeric", min: "0", step: "10",
        class: "price-input",
        "aria-label": `${PRICE_ROWS.find((r) => r.kind === kind).label} ${category === "univ" ? "大学生以上" : "高校生"}`,
        dataset: { kind, category },
        onchange: () => {
          const value = Math.max(0, Math.round(Number(field.value) || 0));
          ctx.update((d) => { d.prices[kind][category] = value; });
        },
      });
      field.value = data.prices[kind][category];
      return field;
    };
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "料金（1人あたり）" }),
      el("table", { class: "table price-table" }, [
        el("thead", {}, el("tr", {}, [el("th", { text: "" }), el("th", { text: "大学生以上" }), el("th", { text: "高校生" })])),
        el("tbody", {}, PRICE_ROWS.map((r) => el("tr", {}, [
          el("th", { scope: "row", text: r.label }),
          el("td", {}, [input(r.kind, "univ"), "円"]),
          el("td", {}, [input(r.kind, "high"), "円"]),
        ]))),
      ]),
      el("p", { class: "field-hint", text: "変更すると下の合計がすぐ再計算されます。宿泊は1泊ごと（両日泊まる人は2泊分）。" }),
    ]);
  }

  function scenarioSwitch(ctx) {
    const button = (value, label) => el("button", {
      type: "button",
      class: "choice-button",
      "aria-pressed": String(includeMaybe === value),
      text: label,
      onclick: () => { includeMaybe = value; ctx.rerender(); },
    });
    return el("div", { class: "choice-group scenario", role: "group", "aria-label": "集計の対象" }, [
      button(false, "確定のみ"),
      button(true, "未確定も含む見込み"),
    ]);
  }

  // メモの「収入」表と同じ形（日程 × 内容 × 大学生／高校生）
  function incomeTable(data, result) {
    const p = data.prices;
    const line = (date, label, key, kind) => {
      const counts = result.counts[key];
      const amounts = result.amounts[key];
      const cell = (category) => counts[category]
        ? el("td", {}, [el("span", { class: "amount", text: yen(amounts[category]) }), el("span", { class: "sub calc-note", text: `${counts[category]}人×${Number(p[kind][category]).toLocaleString("ja-JP")}` })])
        : el("td", { class: "muted", text: "—" });
      return el("tr", {}, [
        el("th", { scope: "row" }, [el("span", { class: "sub", text: date }), label]),
        cell("univ"),
        cell("high"),
        el("td", { class: "amount", text: yen(amounts.univ + amounts.high) }),
      ]);
    };
    return el("table", { class: "table income-table" }, [
      el("thead", {}, el("tr", {}, ["内容", "大学生以上", "高校生", "合計"].map((t) => el("th", { text: t })))),
      el("tbody", {}, [
        line("11日", "えあび🏠", "stay11", "stay"),
        line("11日", "たこぱ🐙（宿泊者）", "takoStay", "takoStay"),
        line("11日", "たこぱ🐙（たこパのみ）", "takoOnly", "tako"),
        line("", "スイーツ🍰", "sweets", "sweets"),
        line("12日", "えあび🏠", "stay12", "stay"),
        el("tr", {}, [
          el("th", { scope: "row", text: "キャンセル料" }),
          el("td", { colspan: "2" }, el("span", { class: "sub", text: result.cancelCount ? `${result.cancelCount}人（固定料金の50%）` : "なし" })),
          el("td", { class: "amount", text: yen(result.cancelIncome) }),
        ]),
      ]),
      el("tfoot", {}, el("tr", {}, [el("th", { scope: "row", text: "収入合計" }), el("td", { colspan: "2" }), el("td", { class: "amount strong", text: yen(result.income) })])),
    ]);
  }

  function balanceCard(data, result) {
    const unpriced = data.shopping.filter((b) => (b.actual === null || b.actual === undefined || b.actual === "") && (b.planned === null || b.planned === undefined || b.planned === "")).length;
    const step = (label, value, options) => el("tr", { class: options && options.strong ? "is-strong" : "" }, [
      el("th", { scope: "row", text: label }),
      el("td", { class: "amount", text: (options && options.sign ? options.sign : "") + yen(value) }),
    ]);
    let outcome;
    if (result.deficit > 0) {
      outcome = el("div", { class: "outcome outcome-deficit" }, [
        el("p", { class: "outcome-title", text: `${yen(result.deficit)} 足りません` }),
        result.univCount
          ? el("p", { text: `大学生以上 ${result.univCount}人で割って、1人 ${yen(result.sharePerUniv)} を追加で集めます（10円未満切り捨て。2日目の宿泊のみの人は除く）。` })
          : el("p", { text: "割り勘する大学生がいません。" }),
        result.shareShortfall > 0 ? el("p", { class: "sub", text: `切り捨てで残る ${yen(result.shareShortfall)} は主催者の負担です。` }) : null,
      ]);
    } else if (result.surplus > 0) {
      outcome = el("div", { class: "outcome outcome-surplus" }, [
        el("p", { class: "outcome-title", text: `${yen(result.surplus)} 余ります` }),
        el("p", { text: `① 主催者の宿泊費1泊分を無料: ${yen(result.organizerWaiverTotal)}` }),
        el("p", { text: result.discountPerStayer > 0 ? `② 宿泊者全員の宿泊費を1人 ${yen(result.discountPerStayer)} 割引` : "② 宿泊者への割引: なし" }),
        el("p", { class: "sub", text: `配分しきれない残り: ${yen(result.surplusLeft)}（10円未満の切り捨て・宿泊費の上限による）` }),
      ]);
    } else {
      outcome = el("div", { class: "outcome" }, el("p", { class: "outcome-title", text: "収支はぴったりです" }));
    }
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "収支" }),
      el("table", { class: "table steps" }, el("tbody", {}, [
        step("収入合計", result.income),
        step("会場代（Airbnb）", result.venueCost, { sign: "−" }),
        step("食費に充てられる額", result.afterVenue, { strong: true }),
        step("食費（買い物リスト＋食費）", result.foodCost, { sign: "−" }),
        result.otherCost ? step("その他の費用", result.otherCost, { sign: "−" }) : null,
        step(result.balance >= 0 ? "残り" : "不足", Math.abs(result.balance), { strong: true }),
      ])),
      unpriced ? el("p", { class: "warning", text: `買い物リストに金額が未入力の品が ${unpriced}品あります。食費が確定するまで、割り勘・割引の金額は暫定です。` }) : null,
      outcome,
    ]);
  }

  function expensesCard(data, result, ctx) {
    const kindLabel = (kind) => (EXPENSE_KINDS.find((k) => k.value === kind) || EXPENSE_KINDS[2]).label;
    const fields = [
      { key: "name", label: "内容", type: "text" },
      { key: "amount", label: "金額（円）", type: "number" },
      { key: "kind", label: "種類", type: "choice", options: EXPENSE_KINDS, hint: "会場代は収入からまず引きます。食費・その他はその残りから引きます" },
      { key: "note", label: "メモ", type: "text" },
    ];
    const edit = (expense) => openForm({
      title: expense ? "費用を編集" : "費用を追加",
      fields,
      values: expense || { id: newId("e"), name: "", amount: null, kind: "food", note: "" },
      submitLabel: expense ? "決定" : "追加",
      onSubmit: (values) => {
        if (!String(values.name || "").trim()) return "内容を入力してください";
        const next = Object.assign({}, values, { name: values.name.trim(), amount: Math.max(0, Math.round(Number(values.amount) || 0)) });
        ctx.update((d) => {
          const index = d.expenses.findIndex((e) => e.id === next.id);
          if (index >= 0) d.expenses[index] = next;
          else d.expenses.push(next);
        });
        return null;
      },
      onDelete: expense ? () => {
        let index = -1;
        ctx.update((d) => { index = d.expenses.findIndex((e) => e.id === expense.id); d.expenses.splice(index, 1); });
        toast(`${expense.name} を削除しました`, () => ctx.update((d) => { d.expenses.splice(index, 0, expense); }));
      } : null,
    });
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "費用" }),
      el("ul", { class: "line-list" }, [
        ...data.expenses.map((e) => el("li", {}, el("button", { type: "button", class: "line", onclick: () => edit(e) }, [
          el("span", { class: "line-main" }, [e.name, el("span", { class: "sub", text: [kindLabel(e.kind), e.note].filter(Boolean).join("・") })]),
          el("span", { class: "amount", text: yen(Number(e.amount) || 0) }),
        ]))),
        el("li", { class: "line line-static" }, [
          el("span", { class: "line-main" }, ["買い物リスト", el("span", { class: "sub", text: `${data.shopping.length}品（実際の金額があればそれ、なければ予定金額）` })]),
          el("span", { class: "amount", text: yen(result.shoppingCost) }),
        ]),
      ]),
      el("button", { type: "button", class: "button button-block", text: "＋ 費用を追加", onclick: () => edit(null) }),
    ]);
  }

  function collectionCard(data, result, ctx) {
    const people = data.participants.filter((p) => result.perPerson[p.id].due > 0);
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "集金" }),
      el("dl", { class: "summary-grid" }, [
        el("dt", { text: "集金済み" }), el("dd", { class: "amount", text: yen(result.collected) }),
        el("dt", { text: "未集金" }), el("dd", { class: "amount strong", text: yen(result.uncollected) }),
      ]),
      el("ul", { class: "line-list" }, people.map((person) => {
        const entry = result.perPerson[person.id];
        const parts = [];
        if (entry.stay) parts.push(`宿泊${yen(entry.stay)}`);
        if (entry.tako) parts.push(`たこパ${yen(entry.tako)}`);
        if (entry.sweets) parts.push(`スイーツ${yen(entry.sweets)}`);
        if (entry.discount) parts.push(`割引−${yen(entry.discount)}`);
        if (entry.share) parts.push(`割り勘＋${yen(entry.share)}`);
        if (entry.cancelFee) parts.push(`キャンセル料${yen(entry.cancelFee)}`);
        const checkbox = el("input", {
          type: "checkbox",
          id: `paid-${person.id}`,
          onchange: () => ctx.update((d) => { d.participants.find((p) => p.id === person.id).paid = checkbox.checked; }),
        });
        checkbox.checked = Boolean(person.paid);
        return el("li", { class: "line line-static" }, [
          el("label", { class: "check-row line-main", for: `paid-${person.id}` }, [
            checkbox,
            el("span", {}, [person.name, el("span", { class: "sub", text: parts.join("・") })]),
          ]),
          el("span", { class: "amount", text: yen(entry.due) }),
        ]);
      })),
      el("p", { class: "field-hint", text: "チェックすると支払い済みになります。割り勘・割引は人数や費用が変わると変動します。" }),
    ]);
  }

  function render(container, data, ctx) {
    const result = calc.computeAccounting(data, { includeMaybe });
    const other = calc.computeAccounting(data, { includeMaybe: !includeMaybe });
    container.replaceChildren(
      priceTable(data, ctx),
      el("section", { class: "card" }, [
        el("h2", { class: "card-title", text: "収入（区分ごと）" }),
        scenarioSwitch(ctx),
        el("p", { class: "compare", text: includeMaybe ? `確定のみの収入: ${yen(other.income)}` : `未確定も含む見込みの収入: ${yen(other.income)}` }),
        el("div", { class: "table-scroll" }, incomeTable(data, result)),
      ]),
      balanceCard(data, result),
      expensesCard(data, result, ctx),
      collectionCard(data, calc.computeAccounting(data, {}), ctx),
    );
  }

  global.TakopaViews = Object.assign(global.TakopaViews || {}, { accounting: render });
})(window);
