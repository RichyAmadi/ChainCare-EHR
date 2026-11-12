"""Render real command output as terminal-style screenshots for the report."""
import html, re, sys
from playwright.sync_api import sync_playwright

ANSI = re.compile(r'\x1b\[[0-9;]*m')

def colour(line):
    t = html.escape(ANSI.sub('', line))
    if re.search(r'(✓|✔|PASS|passed|pass \d|PASS:)', t) and 'fail 0' not in t: return f'<span class=ok>{t}</span>'
    if re.search(r'(✕|✖|FAIL(?!-NEW: 0)|failed|WARN-NEW: [1-9])', t): return f'<span class=bad>{t}</span>'
    if t.startswith('$'): return f'<span class=cmd>{t}</span>'
    if re.search(r'^(ℹ|Test Suites|Tests:|Snapshots|Time:|FAIL-NEW)', t): return f'<span class=info>{t}</span>'
    return t

def render(name, title, lines, width=1100):
    body = '\n'.join(colour(l) for l in lines)
    page_html = f'''<html><head><style>
    body{{margin:0;background:#fff;font-family:Consolas,'DejaVu Sans Mono',monospace}}
    .win{{margin:12px;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.25);width:{width}px}}
    .bar{{background:#2d3331;color:#cfd8d4;font:13px Arial;padding:7px 12px}}
    .bar i{{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;background:#e0605a}}
    .bar i+i{{background:#e8b84a}} .bar i+i+i{{background:#58b65f;margin-right:14px}}
    pre{{margin:0;background:#151a18;color:#d6dfdb;padding:14px 16px;font-size:13.5px;line-height:1.45;white-space:pre-wrap}}
    .ok{{color:#5fd38a}} .bad{{color:#ff7b72}} .cmd{{color:#f2cc60}} .info{{color:#8ab4f8}}
    </style></head><body><div class=win><div class=bar><i></i><i></i><i></i>{html.escape(title)}</div><pre>{body}</pre></div></body></html>'''
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(device_scale_factor=2, viewport={'width': width + 30, 'height': 400})
        pg.set_content(page_html); pg.locator('.win').screenshot(path=f'/root/ehr/screenshots/full/{name}.png'); b.close()
    print('rendered', name)

if __name__ == '__main__':
    cc = open('/root/ehr/results/chaincode_tests_full.txt').read().splitlines()
    render('t1_chaincode_tests', 'chaincode — npm test', ['$ cd chaincode && npm test'] + [l for l in cc if l.strip()])
    api = [l for l in open('/root/ehr/results/api_tests_full.txt').read().splitlines() if l.strip() and 'Mongoose' not in l and 'node --trace' not in l]
    render('t2_api_tests', 'backend — npm test', ['$ cd backend && npm test'] + api)
