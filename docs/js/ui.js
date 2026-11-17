// 画面の共通部品: 要素の生成、金額表示、トースト、編集用のボトムシート
(function (global) {
  "use strict";

  const TOAST_DURATION_MS = 6000;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, value);
    });
    (Array.isArray(children) ? children : children === undefined ? [] : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function yen(value) {
    return `${Math.round(value).toLocaleString("ja-JP")}円`;
  }

  function newId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // ---------- トースト（取り消し付き） ----------
  let toastTimer = null;
  function toast(message, undo) {
    const box = document.getElementById("toast");
    const text = document.getElementById("toast-text");
    const button = document.getElementById("toast-undo");
    clearTimeout(toastTimer);
    // モーダル表示中は背面が操作できないので、開いているシートの中に出す
    const openSheet = document.querySelector("dialog[open]");
    const host = openSheet || document.body;
    if (box.parentElement !== host) host.append(box);
    text.textContent = message;
    button.hidden = !undo;
    button.onclick = () => {
      hide();
      undo();
      toast("元に戻しました");
    };
    box.hidden = false;
    toastTimer = setTimeout(hide, TOAST_DURATION_MS);
    function hide() {
      box.hidden = true;
    }
  }

  // ---------- シート ----------
  function openSheet(sheet) {
    document.documentElement.classList.add("sheet-open");
    if (!sheet.open) sheet.showModal();
  }

  function closeSheet(sheet) {
    if (sheet.open) sheet.close();
  }

  function setupSheet(sheet) {
    sheet.addEventListener("close", () => {
      if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("sheet-open");
      const box = document.getElementById("toast");
      if (box.parentElement === sheet) document.body.append(box);
    });
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) closeSheet(sheet);
    });
  }

  // 編集フォーム。fields: [{ key, label, type, options, hint, show(values) }]
  // type: text | number | textarea | checkbox | choice（ボタンで1つ選ぶ）
  function openForm({ title, fields, values, onSubmit, onDelete, submitLabel }) {
    const sheet = document.getElementById("form-sheet");
    const body = sheet.querySelector(".sheet-body");
    const state = Object.assign({}, values);
    const rows = [];

    function refreshVisibility() {
      rows.forEach(({ field, row, input }) => {
        row.hidden = field.show ? !field.show(state) : false;
        if (field.disabled && input) {
          const disabled = field.disabled(state);
          input.disabled = disabled;
          row.classList.toggle("is-disabled", disabled);
        }
        if (field.type === "checkbox" && input) input.checked = Boolean(state[field.key]);
      });
    }

    function fieldRow(field) {
      const id = `field-${field.key}`;
      let input = null;
      let control;
      if (field.type === "checkbox") {
        input = el("input", { type: "checkbox", id, onchange: () => { state[field.key] = input.checked; refreshVisibility(); } });
        input.checked = Boolean(state[field.key]);
        control = el("label", { class: "check-row", for: id }, [input, el("span", { text: field.label })]);
      } else if (field.type === "choice") {
        const group = el("div", { class: "choice-group", role: "group", "aria-label": field.label });
        field.options.forEach((option) => {
          const button = el("button", {
            type: "button",
            class: "choice-button",
            text: option.label,
            dataset: { value: option.value },
            "aria-pressed": String(state[field.key] === option.value),
            onclick: () => {
              state[field.key] = option.value;
              group.querySelectorAll(".choice-button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === option.value)));
              refreshVisibility();
            },
          });
          group.append(button);
        });
        control = el("div", { class: "field" }, [el("span", { class: "field-label", text: field.label }), group]);
      } else {
        const common = {
          id,
          class: "text-input",
          oninput: () => {
            state[field.key] = field.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
          },
        };
        input = field.type === "textarea"
          ? el("textarea", Object.assign({ rows: field.rows || 8 }, common))
          : el("input", Object.assign({
            type: field.type === "number" ? "number" : "text",
            inputmode: field.type === "number" ? "numeric" : undefined,
            min: field.type === "number" ? "0" : undefined,
            autocomplete: "off",
          }, common));
        input.value = state[field.key] === null || state[field.key] === undefined ? "" : state[field.key];
        control = el("div", { class: "field" }, [el("label", { class: "field-label", for: id, text: field.label }), input]);
      }
      const row = el("div", { class: "form-row" }, [control, field.hint ? el("p", { class: "field-hint", text: field.hint }) : null]);
      rows.push({ field, row, input });
      return row;
    }

    const form = el("form", {
      class: "form",
      onsubmit: (event) => {
        event.preventDefault();
        const error = onSubmit(state);
        if (typeof error === "string") {
          formError.textContent = error;
          formError.hidden = false;
          return;
        }
        closeSheet(sheet);
      },
    });
    const formError = el("p", { class: "form-error", hidden: true });
    fields.forEach((field) => form.append(fieldRow(field)));
    form.append(formError);
    form.append(el("div", { class: "form-actions" }, [
      onDelete ? el("button", {
        type: "button",
        class: "button button-danger",
        text: "削除",
        onclick: () => { closeSheet(sheet); onDelete(); },
      }) : null,
      el("button", { type: "submit", class: "button button-primary", text: submitLabel || "決定" }),
    ]));

    body.replaceChildren(
      el("div", { class: "sheet-head" }, [
        el("p", { class: "sheet-title", text: title }),
        el("button", { type: "button", class: "sheet-close", "aria-label": "閉じる", text: "×", onclick: () => closeSheet(sheet) }),
      ]),
      form,
    );
    refreshVisibility();
    openSheet(sheet);
  }

  global.TakopaUI = { el, yen, newId, toast, openSheet, closeSheet, setupSheet, openForm };
})(window);
