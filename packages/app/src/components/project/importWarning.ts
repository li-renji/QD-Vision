/**
 * 导入告警的 UI 呈现口径（FR-063⑦）。
 *
 * ## 为什么单独成模块
 *
 * 「只呈现 `duration-recomputed`」是一条**强制**的 UI 规则，且必须**可被测试直接断言**
 * —— 若它内联在组件里，测试只能复制一份逻辑去断言，复制品与真实代码可能不一致，
 * 规则一旦被改坏，测试仍然是绿的。
 *
 * 因此把规则抽成本模块的纯函数，组件与测试**共用同一份实现**。
 *
 * 本模块位于**组件层**（不是领域层）：领域层只产出数据，不决定「要不要告知用户」。
 */

import type { DeserializeWarning } from '../../domain/project/deserialize.js';

/**
 * 统计需要在 UI 上呈现的告警条数（FR-063⑦ 强制过滤规则）。
 *
 * ⚠️ **只统计 `duration-recomputed`** —— `value-clamped` 不得进入 UI。
 *
 * 理由（PRD §9.10 决策一第 3 行）：数值钳制是**常规容错**（`scale=1000` 这类值没有
 * 合法意图，钳到 20 是标准容错），告知用户会造成「导入一个正常工程却看到一堆警告」
 * 的噪音；而 `durationMs` 不符是**文件自相矛盾**，性质不同，必须告知。
 *
 * 写成**显式 filter**（而非「遍历全部 warnings」）—— 只有 `duration-recomputed`
 * 这一类 code 会被计入。
 *
 * @param warnings `deserialize` 返回的告警数组
 * @returns 需要呈现的告警条数（0 表示不呈现任何告警）
 */
export function countPresentableWarnings(warnings: readonly DeserializeWarning[]): number {
  return warnings.filter((warning) => warning.code === 'duration-recomputed').length;
}
