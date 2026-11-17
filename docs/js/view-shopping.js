// 買い物リストタブ: 品目ごとの予定金額・実際の金額・購入済み・担当。合計は会計の食費に入る
(function (global) {
  "use strict";

  const { el, yen, newId, toast, openForm } = global.TakopaUI;
  const calc = global.TakopaCalc;

  const FIELDS = [
    { key: "name", label: "品名", type: "text" },
    { key: "planned", label: "予定金額（円）", type: "number" },
    { key: "actual", label: "実際の金額（円）", type: "number", hint: "買ったら入力。会計では実際の金額を優先して使います" },
    { key: "assignee", label: "担当", type: "text" },
    { key: "purchased", label: "購入済み", type: "checkbox" },
    { key: "note", label: "メモ", type: "textarea", rows: 3 },
  ];

  function toAmount(value) {
    return value === null || value === "" || value === undefined ? null : Math.max(0, Math.round(Number(value) || 0));
  }

  function edit(item, ctx) {
    openForm({
      title: item ? "買い物を編集" : "買い物を追加",
      fields: FIELDS,
      values: item || { id: newId("b"), name: "", planned: null, actual: null, purchased: false, assignee: "", note: "" },
      submitLabel: item ? "決定" : "追加",
      onSubmit: (values) => {
        if (!String(values.name || "").trim()) return "品名を入力してください";
        const next = Object.assign({}, values, { name: values.name.trim(), planned: toAmount(values.planned), actual: toAmount(values.actual) });
        ctx.update((d) => {
          const index = d.shopping.findIndex((b) => b.id === next.id);
          if (index >= 0) d.shopping[index] = next;
          else d.shopping.push(next);
        });
        return null;
      },
      onDelete: item ? () => {
        let index = -1;
        ctx.update((d) => { index = d.shopping.findIndex((b) => b.id === item.id); d.shopping.splice(index, 1); });
        toast(`${item.name} を削除しました`, () => ctx.update((d) => { d.shopping.splice(index, 0, item); }));
      } : null,
    });
  }

  function row(item, ctx) {
    const checkbox = el("input", {
      type: "checkbox",
      class: "row-check",
      "aria-label": `${item.name} を購入済みにする`,
      onchange: () => ctx.update((d) => { d.shopping.find((b) => b.id === item.id).purchased = checkbox.checked; }),
    });
    checkbox.checked = Boolean(item.purchased);
    const hasActual = item.actual !== null && item.actual !== undefined;
    const hasPlanned = item.planned !== null && item.planned !== undefined;
    return el("li", { class: `shop-item${item.purchased ? " is-done" : ""}` }, [
      checkbox,
      el("button", { type: "button", class: "line", dataset: { id: item.id }, onclick: () => edit(item, ctx) }, [
        el("span", { class: "line-main" }, [
          el("span", { class: "shop-name", text: item.name }),
          el("span", { class: "sub", text: [item.assignee && `担当 ${item.assignee}`, item.note].filter(Boolean).join("・") }),
        ]),
        el("span", { class: "shop-amount" }, hasActual
          ? [el("span", { class: "amount", text: yen(item.actual) }), el("span", { class: "sub", text: "実際" })]
          : hasPlanned
            ? [el("span", { class: "amount muted", text: yen(item.planned) }), el("span", { class: "sub", text: "予定" })]
            : [el("span", { class: "sub", text: "金額未定" })]),
      ]),
    ]);
  }

  function render(container, data, ctx) {
    const items = data.shopping;
    const planned = items.reduce((sum, b) => sum + (Number(b.planned) || 0), 0);
    const actual = items.reduce((sum, b) => sum + (Number(b.actual) || 0), 0);
    const used = items.reduce((sum, b) => sum + calc.shoppingAmount(b), 0);
    const done = items.filter((b) => b.purchased).length;
    container.replaceChildren(
      el("section", { class: "card summary" }, [
        el("h2", { class: "card-title", text: "買い物リスト" }),
        el("dl", { class: "summary-grid" }, [
          el("dt", { text: "購入済み" }), el("dd", { text: `${done} / ${items.length}品` }),
          el("dt", { text: "予定金額の合計" }), el("dd", { class: "amount", text: yen(planned) }),
          el("dt", { text: "実際の金額の合計" }), el("dd", { class: "amount", text: yen(actual) }),
          el("dt", { text: "会計に入る食費" }), el("dd", { class: "amount strong", text: yen(used) }),
        ]),
      ]),
      el("button", { type: "button", class: "button button-primary button-block", text: "＋ 買い物を追加", onclick: () => edit(null, ctx) }),
      el("section", { class: "card" }, items.length
        ? el("ul", { class: "shop-list" }, items.map((b) => row(b, ctx)))
        : el("p", { class: "empty", text: "まだ品目がありません" })),
      el("p", { class: "field-hint", text: "左のチェックで購入済み。品名を押すと金額・担当を編集できます。" }),
    );
  }

  global.TakopaViews = Object.assign(global.TakopaViews || {}, { shopping: render });
})(window);
