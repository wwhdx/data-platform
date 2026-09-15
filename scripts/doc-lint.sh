#!/usr/bin/env bash
# 文档集一致性检查：把「状态/数字只留一处」从纪律变成机械检查。
# 规范真源 → docs/doc-writing-guide.md §5 · .cursor/rules/doc-writing.mdc §5
#
# 只检查「高信号」形态（能一眼判定为漂移源）；不检查能力对照表里的 ✅
# （如「该上游 API 是否提供摘要」「存储方案对比」——那些是外部/设计事实，非项目进度）。
#
# ⑥ 结构检查：跨文档链接/锚点 + 表格列数 → scripts/doc-structure.py
#
# 用法：bash scripts/doc-lint.sh   （有命中即退出码 1）
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

TRUTH='docs/plans/实施进度总览.md'
ARCHIVED='docs/phase1-plan.md'
fail=0

files() { # 排除真源与已归档稿
   git -c core.quotepath=false ls-files '*.md' | grep -v -x -e "$TRUTH" -e "$ARCHIVED"
}

report() {
  printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$2"
  fail=1
}

# ① 方案文首/索引行的「状态」断言（应改为「见实施进度 §x」）
hits=$(files | xargs grep -n -E '^> \*\*(状态|进度)\*\*' 2>/dev/null \
  | grep -E '✅|🟡|□|⏸|已落地|已实现|已完成|待实施' || true)
[ -n "$hits" ] && report "① 文首「状态/进度」行携带状态清单 —— 改为「见实施进度 §x」" "$hits"

# ② 真源之外的数量断言（Connector / 测试数），须带快照日期
#    跳过代码块（ASCII 图）与 §变更记录 行（历史记录，不是当前断言）
hits=$(for f in $(files); do
      awk -v F="$f" '/^\x60\x60\x60/ {code=!code; next} code {next} {print F":"FNR":"$0}' "$f"
    done | grep -E '[0-9]{2,} *(个)? *(Connector|connector)|[0-9]{2,} *tests|测试数 *[0-9]' 2>/dev/null \
  | grep -v -E '快照|见 §2|见实施进度|不要|禁止|反模式|规范' \
  | grep -v -E '^[^:]+:[0-9]+:\| *(v?[0-9]|20[0-9]{2}-)' || true)
[ -n "$hits" ] && report "② 数量断言无快照日期 —— 删数字或写「(YYYY-MM-DD 快照)」" "$hits"

# ③ 真源之外的 commit 短哈希
hits=$(files | xargs grep -nP '\b(?=[0-9a-f]{7,40}\b)(?=[0-9]*[a-f])[0-9a-f]+\b' 2>/dev/null \
  | sed 's/\([a-f0-9]\{7,40\}\)/[hidden-hash]/' \
  | grep -v -E '快照|不要|禁止|反模式|规范' \
  | grep -vE 'hash|sha|SHA|md5|uuid|http|www|\.com|\.org|node_modules' || true)
[ -n "$hits" ] && report "③ 真源之外的 commit 短哈希 —— 移到实施进度总览 §2" "$hits"

# ④ 文首独立「勘误」行（应直接改对应段落，勘误写进 §变更记录）
hits=$(files | xargs grep -n -E '^> \*\*[^ ]*勘误' 2>/dev/null || true)
[ -n "$hits" ] && report "④ 独立「勘误」行 —— 直接改对应段落，勘误写进 §变更记录" "$hits"

# ⑥ 链接/锚点 + 表格列数（指针化文档靠链接；标题一改锚点就失效）
if ! hits=$(python3 scripts/doc-structure.py 2>&1); then
  report "⑥ 失效链接/锚点 或 表格列数不齐 —— 修链接、同步标题锚点、补齐单元格" "$hits"
fi

# ⑤ 状态标记密度（参考，不判失败）
printf '\n\033[1m⑤ 状态标记密度（>30 的 docs 文件，参考不判失败）\033[0m\n'
for f in $(files | grep '^docs/'); do
  n=$(grep -c -E '✅|🟡|□|⏸' "$f" 2>/dev/null)
  n=${n:-0}
  [ "$n" -gt 30 ] && printf '  %4s  %s\n' "$n" "$f"
done
true

[ "$fail" -eq 0 ] && printf '\n\033[32m✓ 文档集一致性检查通过\033[0m\n'
exit "$fail"
