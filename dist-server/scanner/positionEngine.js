/**
 * 倉位計算引擎
 * 根據信號強度和帳戶資金計算建議買入股數、金額
 */
/** 根據 score 確定目標倉位比例 */
function getTargetPct(score) {
    if (score >= 90)
        return 0.20;
    if (score >= 80)
        return 0.15;
    if (score >= 70)
        return 0.10;
    return 0.05;
}
/** 計算倉位建議 */
export function calcPosition(input) {
    const { totalCapital, availableCash, currentPrice, score, existingShares = 0, existingAvgCost = 0, } = input;
    const isAdd = existingShares > 0;
    const action = isAdd ? 'add' : 'buy';
    const targetPct = getTargetPct(score);
    // 目標金額
    let targetAmount = totalCapital * targetPct;
    // 保留現金緩衝（強信號 5%，弱信號 10%）
    const cashBuffer = totalCapital * (score >= 90 ? 0.05 : 0.10);
    const spendable = availableCash - cashBuffer;
    if (spendable <= 0)
        return null; // 現金不足
    // 不超過總資金 30%
    const maxSinglePosition = totalCapital * 0.30;
    const existingValue = existingShares * existingAvgCost;
    const remainAllowed = maxSinglePosition - existingValue;
    if (remainAllowed <= 0)
        return null; // 已超上限
    targetAmount = Math.min(targetAmount, spendable, remainAllowed);
    if (targetAmount < currentPrice)
        return null; // 不夠買 1 股
    // 向下取整到整股
    const shares = Math.floor(targetAmount / currentPrice);
    if (shares < 1)
        return null;
    const amount = parseFloat((shares * currentPrice).toFixed(2));
    const notes = isAdd
        ? `加倉 ${shares} 股，攤低成本至 $${calcNewAvgCost(existingShares, existingAvgCost, shares, currentPrice).toFixed(2)}`
        : `買入 ${shares} 股，佔總資金 ${(amount / totalCapital * 100).toFixed(1)}%`;
    return {
        action,
        suggestedShares: shares,
        suggestedPrice: currentPrice,
        suggestedAmount: amount,
        targetPct,
        notes,
    };
}
function calcNewAvgCost(oldShares, oldAvgCost, addShares, addPrice) {
    const total = oldShares + addShares;
    return (oldShares * oldAvgCost + addShares * addPrice) / total;
}
//# sourceMappingURL=positionEngine.js.map