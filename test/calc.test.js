// 会計計算のテスト（個人情報を含まない架空のデータで確認する）
const test = require("node:test");
const assert = require("node:assert/strict");
const calc = require("../docs/js/calc.js");

const PRICES = {
  stay: { univ: 5000, high: 3500 },
  tako: { univ: 1000, high: 500 },
  takoStay: { univ: 1000, high: 500 },
  sweets: { univ: 0, high: 0 },
};

let seq = 0;
function person(overrides) {
  seq += 1;
  return Object.assign({
    id: `t${seq}`, name: `テスト${seq}`, category: "univ", status: "confirmed",
    stay11: false, stay12: false, takoOnly: false, sweets: false,
    organizer: false, paid: false, cancelFee: false,
  }, overrides);
}

function data(participants, extra) {
  return Object.assign({
    prices: JSON.parse(JSON.stringify(PRICES)),
    participants,
    expenses: [],
    shopping: [],
  }, extra);
}

test("状態の色: 赤=宿泊確定 緑=宿泊なし確定 青=未確定 灰=キャンセル", () => {
  assert.equal(calc.statusColor(person({ stay12: true })), "red");
  assert.equal(calc.statusColor(person({ takoOnly: true })), "green");
  assert.equal(calc.statusColor(person({ status: "maybe", stay11: true })), "blue");
  assert.equal(calc.statusColor(person({ status: "cancelled", stay11: true })), "gray");
});

test("宿泊は1泊ごと。両日泊まる大学生は 5,000×2、11日泊は自動でたこパ（宿泊者料金）", () => {
  const fees = calc.fixedFees(person({ stay11: true, stay12: true }), PRICES);
  assert.deepEqual(fees, { stay: 10000, tako: 1000, sweets: 0, total: 11000 });
});

test("12日のみ宿泊の人はたこパに参加しない（たこパのみを付ければ参加）", () => {
  assert.equal(calc.fixedFees(person({ stay12: true }), PRICES).tako, 0);
  assert.equal(calc.joinsTako(person({ stay12: true })), false);
  assert.equal(calc.fixedFees(person({ stay12: true, takoOnly: true }), PRICES).tako, 1000);
});

test("宿泊者のたこパ料金は、たこパのみと別に設定できる", () => {
  const prices = JSON.parse(JSON.stringify(PRICES));
  prices.takoStay.high = 0;
  assert.equal(calc.fixedFees(person({ category: "high", stay11: true }), prices).tako, 0);
  assert.equal(calc.fixedFees(person({ category: "high", takoOnly: true }), prices).tako, 500);
});

test("収入から会場代を引き、食費が上回った分を大学生全員で割る（10円未満切り捨て）", () => {
  const people = [
    person({ stay11: true }),                         // 5,000 + 1,000
    person({ takoOnly: true }),                       // 1,000
    person({ category: "univ", status: "confirmed", stay12: true }), // 5,000
    person({ category: "high", stay11: true }),       // 3,500 + 500
  ];
  const result = calc.computeAccounting(data(people, {
    expenses: [{ id: "e1", name: "会場", amount: 10000, kind: "venue" }],
    shopping: [{ id: "b1", name: "食材", planned: 9000, actual: 10001 }],
  }), {});
  assert.equal(result.income, 16000);
  assert.equal(result.afterVenue, 6000);
  assert.equal(result.foodCost, 10001); // 実際の金額があればそれを使う
  assert.equal(result.deficit, 4001);
  assert.equal(result.univCount, 3);
  assert.equal(result.sharePerUniv, 1330); // 4001 / 3 = 1333.6 → 1330
  assert.equal(result.shareShortfall, 11);
  assert.equal(result.perPerson[people[0].id].due, 6000 + 1330);
  assert.equal(result.perPerson[people[3].id].due, 4000); // 高校生は割り勘なし
});

test("余剰は主催者の宿泊費1泊分を無料にし、さらに余れば宿泊者全員で均等に割引", () => {
  const organizerA = person({ organizer: true, stay11: true, stay12: true });
  const organizerB = person({ organizer: true, stay11: true, stay12: true });
  const guest = person({ category: "high", stay11: true });
  const result = calc.computeAccounting(data([organizerA, organizerB, guest], {
    expenses: [{ id: "e1", name: "会場", amount: 5000, kind: "venue" }],
  }), {});
  // 収入 11,000×2 + 4,000 = 26,000、余剰 21,000
  assert.equal(result.surplus, 21000);
  assert.equal(result.organizerWaiverTotal, 10000);
  // 残り 11,000 を宿泊者3人で割る → 3,660（宿泊費を上限）
  assert.equal(result.discountPerStayer, 3660);
  assert.equal(result.perPerson[organizerA.id].discount, 5000 + 3660);
  assert.equal(result.perPerson[guest.id].discount, 3500); // 高校生の宿泊費 3,500 が上限
  assert.equal(result.perPerson[guest.id].due, 4000 - 3500);
  assert.equal(result.surplusLeft, 11000 - 3660 * 2 - 3500);
});

test("余剰が主催者の1泊分に満たないときは主催者で均等に分ける", () => {
  const organizerA = person({ organizer: true, stay11: true });
  const organizerB = person({ organizer: true, stay11: true });
  const result = calc.computeAccounting(data([organizerA, organizerB], {
    expenses: [{ id: "e1", name: "会場", amount: 9005, kind: "venue" }],
  }), {});
  assert.equal(result.surplus, 2995);
  assert.equal(result.perPerson[organizerA.id].discount, 1490);
  assert.equal(result.discountPerStayer, 0);
  assert.equal(result.surplusLeft, 2995 - 1490 * 2);
});

test("キャンセル料は固定料金の50%。キャンセル料なしの人は0円", () => {
  const withFee = person({ status: "cancelled", cancelFee: true, stay11: true, stay12: true });
  const noFee = person({ status: "cancelled", cancelFee: false, stay11: true });
  const result = calc.computeAccounting(data([withFee, noFee]), {});
  assert.equal(result.cancelIncome, 5500);
  assert.equal(result.perPerson[withFee.id].due, 5500);
  assert.equal(result.perPerson[noFee.id].due, 0);
  assert.equal(result.univCount, 0); // キャンセルした人は割り勘の人数に入らない
});

test("未確定は見込みにだけ含める", () => {
  const confirmed = person({ takoOnly: true });
  const maybe = person({ status: "maybe", stay11: true });
  const d = data([confirmed, maybe]);
  assert.equal(calc.computeAccounting(d, {}).income, 1000);
  assert.equal(calc.computeAccounting(d, { includeMaybe: true }).income, 1000 + 6000);
});

test("料金を変えると合計が変わる", () => {
  const d = data([person({ category: "high", stay11: true }), person({ category: "high", takoOnly: true })]);
  assert.equal(calc.computeAccounting(d, {}).income, 4500);
  d.prices.stay.high = 4000;
  d.prices.tako.high = 600;
  assert.equal(calc.computeAccounting(d, {}).income, 5100);
});

test("集金済み・未集金は請求額（割り勘・割引込み）で集計する", () => {
  const paid = person({ category: "high", takoOnly: true, paid: true });
  const unpaid = person({ category: "high", stay11: true });
  // 会場代＝収入にして、割引・割り勘が出ない状態で確認する
  const result = calc.computeAccounting(data([paid, unpaid], {
    expenses: [{ id: "e1", name: "会場", amount: 4500, kind: "venue" }],
  }), {});
  assert.equal(result.balance, 0);
  assert.equal(result.collected, 500);
  assert.equal(result.uncollected, 4000);
});
