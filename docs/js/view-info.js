// 情報タブ: メモ帳の内容（詳細・料金方針・リスク管理・スケジュール・メモ）と準備・役割。すべて編集できる
(function (global) {
  "use strict";

  const { el, newId, toast, openForm } = global.TakopaUI;

  function editSection(section, ctx) {
    openForm({
      title: section ? `「${section.title}」を編集` : "項目を追加",
      fields: [
        { key: "title", label: "見出し", type: "text" },
        { key: "body", label: "本文", type: "textarea", rows: 14 },
      ],
      values: section || { id: newId("s"), title: "", body: "" },
      submitLabel: section ? "決定" : "追加",
      onSubmit: (values) => {
        if (!String(values.title || "").trim()) return "見出しを入力してください";
        const next = Object.assign({}, values, { title: values.title.trim() });
        ctx.update((d) => {
          const index = d.sections.findIndex((s) => s.id === next.id);
          if (index >= 0) d.sections[index] = next;
          else d.sections.push(next);
        });
        return null;
      },
      onDelete: section ? () => {
        let index = -1;
        ctx.update((d) => { index = d.sections.findIndex((s) => s.id === section.id); d.sections.splice(index, 1); });
        toast(`「${section.title}」を削除しました`, () => ctx.update((d) => { d.sections.splice(index, 0, section); }));
      } : null,
    });
  }

  function editRole(role, ctx) {
    openForm({
      title: role ? "役割を編集" : "役割を追加",
      fields: [
        { key: "role", label: "役割", type: "text" },
        { key: "assignee", label: "担当者", type: "text" },
        { key: "done", label: "済み", type: "checkbox" },
        { key: "doneNote", label: "済んだ日など", type: "text" },
        { key: "note", label: "自由記載", type: "textarea", rows: 3 },
      ],
      values: role || { id: newId("r"), role: "", assignee: "", done: false, doneNote: "", note: "" },
      submitLabel: role ? "決定" : "追加",
      onSubmit: (values) => {
        if (!String(values.role || "").trim()) return "役割を入力してください";
        const next = Object.assign({}, values, { role: values.role.trim() });
        ctx.update((d) => {
          const index = d.roles.findIndex((r) => r.id === next.id);
          if (index >= 0) d.roles[index] = next;
          else d.roles.push(next);
        });
        return null;
      },
      onDelete: role ? () => {
        let index = -1;
        ctx.update((d) => { index = d.roles.findIndex((r) => r.id === role.id); d.roles.splice(index, 1); });
        toast(`${role.role} を削除しました`, () => ctx.update((d) => { d.roles.splice(index, 0, role); }));
      } : null,
    });
  }

  function rolesCard(data, ctx) {
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "準備・役割" }),
      el("ul", { class: "shop-list" }, data.roles.map((role) => {
        const checkbox = el("input", {
          type: "checkbox",
          class: "row-check",
          "aria-label": `${role.role} を済みにする`,
          onchange: () => ctx.update((d) => { d.roles.find((r) => r.id === role.id).done = checkbox.checked; }),
        });
        checkbox.checked = Boolean(role.done);
        return el("li", { class: `shop-item${role.done ? " is-done" : ""}` }, [
          checkbox,
          el("button", { type: "button", class: "line", onclick: () => editRole(role, ctx) }, [
            el("span", { class: "line-main" }, [
              el("span", { class: "shop-name", text: role.role }),
              el("span", { class: "sub", text: [role.assignee && `担当 ${role.assignee}`, role.doneNote && `済 ${role.doneNote}`].filter(Boolean).join("・") }),
              role.note ? el("span", { class: "sub", text: role.note }) : null,
            ]),
          ]),
        ]);
      })),
      el("button", { type: "button", class: "button button-block", text: "＋ 役割を追加", onclick: () => editRole(null, ctx) }),
    ]);
  }

  function sectionCard(section, ctx) {
    return el("section", { class: "card", dataset: { section: section.id } }, [
      el("div", { class: "card-head" }, [
        el("h2", { class: "card-title", text: section.title }),
        el("button", { type: "button", class: "button button-small", text: "編集", onclick: () => editSection(section, ctx) }),
      ]),
      el("p", { class: "prose", text: section.body || "（未記入）" }),
    ]);
  }

  function deviceCard(ctx) {
    const version = document.querySelector('meta[name="app-version"]').content;
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: "この端末" }),
      el("p", { class: "field-hint", text: "共有の端末で使い終わったら、合言葉をこの端末から削除してください。" }),
      el("button", { type: "button", class: "button button-danger button-block", id: "forget-button", text: "合言葉をこの端末から削除", onclick: ctx.forget }),
      el("p", { class: "field-hint", text: `バージョン v${version}` }),
    ]);
  }

  function render(container, data, ctx) {
    container.replaceChildren(
      ...data.sections.map((section) => sectionCard(section, ctx)),
      el("button", { type: "button", class: "button button-block", text: "＋ 項目を追加", onclick: () => editSection(null, ctx) }),
      rolesCard(data, ctx),
      deviceCard(ctx),
    );
  }

  global.TakopaViews = Object.assign(global.TakopaViews || {}, { info: render });
})(window);
