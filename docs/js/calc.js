// 料金と会計の計算（画面に依存しない純粋な関数）。ブラウザでは window.TakopaCalc、Node では require で使う。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TakopaCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CANCEL_FEE_RATE = 0.5; // 7日前以降のキャンセル料（固定料金に対する割合）
  const ROUND_UNIT = 10; // 割り勘・割引の1人あたり金額は10円未満を切り捨て
  const CATEGORIES = ["univ", "high"];

  function floorUnit(value) {
    return Math.floor(value / ROUND_UNIT) * ROUND_UNIT;
  }

  function price(prices, kind, category) {
    const value = prices && prices[kind] ? Number(prices[kind][category]) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // 状態の色: 赤＝宿泊確定、緑＝宿泊なしで確定、青＝未確定、灰＝キャンセル
  function statusColor(person) {
    if (person.status === "cancelled") return "gray";
    if (person.status !== "confirmed") return "blue";
    return person.stay11 || person.stay12 ? "red" : "green";
  }

  // 11日に泊まる人は自動でたこパ参加。12日のみの人は「たこパのみ」を付けたときだけ参加
  function joinsTako(person) {
    return Boolean(person.stay11 || person.takoOnly);
  }

  function nights(person) {
    return (person.stay11 ? 1 : 0) + (person.stay12 ? 1 : 0);
  }

  // 割引・割り勘を含まない固定料金
  function fixedFees(person, prices) {
    const category = person.category;
    const stay = nights(person) * price(prices, "stay", category);
    let tako = 0;
    if (person.stay11) tako = price(prices, "takoStay", category);
    else if (person.takoOnly) tako = price(prices, "tako", category);
    const sweets = person.sweets ? price(prices, "sweets", category) : 0;
    return { stay, tako, sweets, total: stay + tako + sweets };
  }

  // 2日目（12日）の宿泊だけに参加する人。食費の割り勘の対象外
  function stay12Only(person) {
    return Boolean(person.stay12 && !person.stay11 && !person.takoOnly && !person.sweets);
  }

  function participates(person) {
    return Boolean(person.stay11 || person.stay12 || person.takoOnly || person.sweets);
  }

  // シナリオで参加者として数えるか（includeMaybe=true なら未確定も来る前提）
  function isActive(person, includeMaybe) {
    if (!participates(person)) return false;
    return person.status === "confirmed" || (includeMaybe && person.status === "maybe");
  }

  function shoppingAmount(item) {
    const actual = Number(item.actual);
    if (item.actual !== null && item.actual !== "" && Number.isFinite(actual)) return actual;
    const planned = Number(item.planned);
    return item.planned !== null && item.planned !== "" && Number.isFinite(planned) ? planned : 0;
  }

  function sumBy(list, fn) {
    return list.reduce((sum, item) => sum + fn(item), 0);
  }

  function emptyCounts() {
    return { univ: 0, high: 0 };
  }

  // 会計の計算。data: ページのデータ、options.includeMaybe: 未確定も含めた見込みにするか
  function computeAccounting(data, options) {
    const includeMaybe = Boolean(options && options.includeMaybe);
    const prices = data.prices || {};
    const people = data.participants || [];
    const perPerson = {};

    const rows = {
      stay11: emptyCounts(), stay12: emptyCounts(),
      takoStay: emptyCounts(), takoOnly: emptyCounts(), sweets: emptyCounts(),
    };
    const amounts = {
      stay11: emptyCounts(), stay12: emptyCounts(),
      takoStay: emptyCounts(), takoOnly: emptyCounts(), sweets: emptyCounts(),
    };
    let cancelIncome = 0;
    let cancelCount = 0;

    people.forEach((person) => {
      const fees = fixedFees(person, prices);
      const entry = { active: false, fixed: 0, stay: 0, tako: 0, sweets: 0, cancelFee: 0, share: 0, discount: 0, due: 0 };
      if (isActive(person, includeMaybe)) {
        Object.assign(entry, { active: true, fixed: fees.total, stay: fees.stay, tako: fees.tako, sweets: fees.sweets });
        const c = person.category;
        const stayPrice = price(prices, "stay", c);
        if (person.stay11) { rows.stay11[c] += 1; amounts.stay11[c] += stayPrice; }
        if (person.stay12) { rows.stay12[c] += 1; amounts.stay12[c] += stayPrice; }
        if (person.stay11) { rows.takoStay[c] += 1; amounts.takoStay[c] += fees.tako; }
        else if (person.takoOnly) { rows.takoOnly[c] += 1; amounts.takoOnly[c] += fees.tako; }
        if (person.sweets) { rows.sweets[c] += 1; amounts.sweets[c] += fees.sweets; }
      } else if (person.status === "cancelled" && person.cancelFee) {
        entry.cancelFee = Math.floor(fees.total * CANCEL_FEE_RATE);
        cancelIncome += entry.cancelFee;
        cancelCount += 1;
      }
      perPerson[person.id] = entry;
    });

    const fixedIncome = sumBy(Object.values(amounts), (a) => a.univ + a.high);
    const income = fixedIncome + cancelIncome;

    const expenses = data.expenses || [];
    const venueCost = sumBy(expenses.filter((e) => e.kind === "venue"), (e) => Number(e.amount) || 0);
    const shopping = data.shopping || [];
    const shoppingCost = sumBy(shopping, shoppingAmount);
    const otherFoodCost = sumBy(expenses.filter((e) => e.kind === "food"), (e) => Number(e.amount) || 0);
    const otherCost = sumBy(expenses.filter((e) => e.kind !== "venue" && e.kind !== "food"), (e) => Number(e.amount) || 0);
    const foodCost = shoppingCost + otherFoodCost;

    // 収入から会場代（Airbnb）を引き、余りを食費（とその他の費用）に充てる
    const afterVenue = income - venueCost;
    const balance = afterVenue - foodCost - otherCost;

    // 不足: 大学生以上で均等に割る（2日目の宿泊のみの人は除く。10円未満切り捨て。切り捨てで残る不足は主催者負担）
    const univIds = people
      .filter((p) => perPerson[p.id].active && p.category === "univ" && !stay12Only(p))
      .map((p) => p.id);
    let deficit = 0;
    let sharePerUniv = 0;
    let shareShortfall = 0;
    if (balance < 0) {
      deficit = -balance;
      if (univIds.length) {
        sharePerUniv = floorUnit(deficit / univIds.length);
        univIds.forEach((id) => { perPerson[id].share = sharePerUniv; });
      }
      shareShortfall = deficit - sharePerUniv * univIds.length;
    }

    // 余剰: ①主催者の宿泊費1泊分を無料 ②さらに余れば宿泊者全員の宿泊費から均等に割引
    let surplus = 0;
    let organizerWaiverTotal = 0;
    let discountPerStayer = 0;
    let surplusLeft = 0;
    if (balance > 0) {
      surplus = balance;
      let remaining = surplus;
      const organizers = people.filter((p) => perPerson[p.id].active && p.organizer && nights(p) > 0);
      const targets = organizers.map((p) => price(prices, "stay", p.category));
      const targetTotal = targets.reduce((a, b) => a + b, 0);
      if (organizers.length && targetTotal > 0) {
        if (remaining >= targetTotal) {
          organizers.forEach((p, i) => { perPerson[p.id].discount += targets[i]; });
          remaining -= targetTotal;
        } else {
          const each = floorUnit(remaining / organizers.length);
          organizers.forEach((p, i) => {
            const amount = Math.min(each, targets[i]);
            perPerson[p.id].discount += amount;
            remaining -= amount;
          });
        }
        organizerWaiverTotal = surplus - remaining;
      }
      // 主催者の1泊分を全額無料にできたときだけ、残りを宿泊者全員に配る
      const organizersFullyWaived = organizerWaiverTotal === targetTotal;
      const stayers = people.filter((p) => perPerson[p.id].active && nights(p) > 0);
      if (remaining > 0 && stayers.length && organizersFullyWaived) {
        discountPerStayer = floorUnit(remaining / stayers.length);
        stayers.forEach((p) => {
          const entry = perPerson[p.id];
          const amount = Math.min(discountPerStayer, entry.stay - entry.discount);
          entry.discount += Math.max(0, amount);
          remaining -= Math.max(0, amount);
        });
      }
      surplusLeft = remaining;
    }

    let collected = 0;
    let uncollected = 0;
    people.forEach((person) => {
      const entry = perPerson[person.id];
      entry.due = entry.active ? entry.fixed - entry.discount + entry.share : entry.cancelFee;
      if (entry.due > 0) {
        if (person.paid) collected += entry.due;
        else uncollected += entry.due;
      }
    });

    return {
      includeMaybe,
      counts: rows,
      amounts,
      fixedIncome,
      cancelIncome,
      cancelCount,
      income,
      venueCost,
      shoppingCost,
      otherFoodCost,
      foodCost,
      otherCost,
      afterVenue,
      balance,
      deficit,
      univCount: univIds.length,
      sharePerUniv,
      shareShortfall,
      surplus,
      organizerWaiverTotal,
      discountPerStayer,
      surplusLeft,
      collected,
      uncollected,
      perPerson,
    };
  }

  return {
    CANCEL_FEE_RATE,
    ROUND_UNIT,
    CATEGORIES,
    statusColor,
    joinsTako,
    nights,
    fixedFees,
    stay12Only,
    participates,
    isActive,
    shoppingAmount,
    computeAccounting,
  };
});
