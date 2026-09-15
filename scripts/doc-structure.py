#!/usr/bin/env python3
"""文档结构检查：跨文档链接/锚点 + 表格列数（doc-lint ⑥）。

① 链接与锚点：文档间靠链接互指，标题改写后旧锚点静默失效 —— 真源
   → docs/doc-writing-guide.md §5「指针化 = 链接必须有效」。
② 表格列数：漏写一个 `|` 会让整行塌成纯文本，肉眼难查（历史漂移重灾区）。

允许清单（ALLOW）：仓库外路径与模板占位符。
用法：python3 scripts/doc-structure.py   （有命中即退出码 1）
"""
import glob
import os
import re
import sys

ALLOW = (
    '../../../engine-core/',  # 父仓文档，不在本仓库
    '<相关方案>', '<专题名称>', '<轨>', '<编号>', '<节>',  # 模板占位符
)
SEP_ROW = re.compile(r'^\s*\|[\s\-:|]+\|\s*$')


def slug(heading: str) -> str:
    """GitHub 风格锚点：小写、去标点、空格转连字符（连续空格 → 连续 -）。"""
    h = heading.strip().lower()
    h = re.sub(r'[`*]', '', h)
    h = re.sub(r'[^\w\u4e00-\u9fff \-]', '', h)
    return h.replace(' ', '-')


def table_cells(line: str) -> int:
    return line.replace('\\|', '').count('|')


def doc_files():
    files = sorted(glob.glob('docs/**/*.md', recursive=True)) + ['README.md', 'AGENTS.md']
    return [f for f in files if os.path.exists(f)]


def strip_fences(text: str):
    """产出 (行号, 行内容)，跳过围栏代码块。"""
    in_fence = False
    for i, line in enumerate(text.split('\n'), 1):
        if line.strip().startswith('```'):
            in_fence = not in_fence
            continue
        if not in_fence:
            yield i, line


def check_links(files):
    slugs = {}
    for f in files:
        slugs[os.path.normpath(f)] = {
            slug(m.group(1))
            for _, line in strip_fences(open(f, encoding='utf-8').read())
            if (m := re.match(r'^#{1,6}\s+(.*)$', line))
        }

    bad = []
    for f in files:
        base = os.path.dirname(os.path.normpath(f))
        for _, line in strip_fences(open(f, encoding='utf-8').read()):
            for m in re.finditer(r'\]\(([^)]+)\)', line):
                link = m.group(1).strip()
                if link.startswith(('http://', 'https://', 'mailto:')):
                    continue
                if any(a in link for a in ALLOW):
                    continue
                target, _, anchor = link.partition('#')
                if not target and not anchor:
                    continue
                path = os.path.normpath(os.path.join(base, target)) if target else os.path.normpath(f)
                if not os.path.exists(path):
                    bad.append(f'{f} → 链接目标不存在：{target}')
                elif anchor and path.endswith('.md') and path in slugs and anchor not in slugs[path]:
                    bad.append(f'{f} → {target}#{anchor} 锚点不存在（标题可能已改）')
    return bad


def check_tables(files):
    bad = []
    for f in files:
        lines = list(strip_fences(open(f, encoding='utf-8').read()))
        k = 0
        while k < len(lines):
            line_next = lines[k + 1][1] if k + 1 < len(lines) else ''
            if lines[k][1].strip().startswith('|') and SEP_ROW.match(line_next):
                n = table_cells(lines[k][1])
                j = k + 2
                while j < len(lines) and lines[j][1].strip().startswith('|'):
                    if table_cells(lines[j][1]) != n:
                        bad.append(f'{f}:{lines[j][0]} 表格列数 {table_cells(lines[j][1])} ≠ 表头 {n}：'
                                   f'{lines[j][1].strip()[:60]}')
                    j += 1
                k = j
            else:
                k += 1
    return bad


def main() -> int:
    files = doc_files()
    link_bad = check_links(files)
    table_bad = check_tables(files)

    for b in link_bad:
        print('  ' + b)
    print(f'  链接/锚点：{len(link_bad)} 处失效' if link_bad else '  链接/锚点：全部有效')
    for b in table_bad:
        print('  ' + b)
    print(f'  表格列数：{len(table_bad)} 行不齐' if table_bad else '  表格列数：全部对齐')
    return 1 if (link_bad or table_bad) else 0


if __name__ == '__main__':
    sys.exit(main())
