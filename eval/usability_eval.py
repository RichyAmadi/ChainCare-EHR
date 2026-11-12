"""Task-completion timing (normal vs throttled 3G) and axe-core accessibility audit.

Usage: python3 usability_eval.py <label> <frontendUrl> <outJson>
Each task is timed from the user's first action until the confirming element is visible.
"""
import json, sys, time, statistics as st
from playwright.sync_api import sync_playwright

LABEL, BASE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PW = 'Passw0rd!2026'
REPS = 3
PROFILES = {
    'Broadband (no throttling)': None,
    'Throttled 3G (1.6 Mbps down, 0.75 Mbps up, 300 ms RTT)': dict(offline=False, latency=300, downloadThroughput=1.6e6 / 8, uploadThroughput=0.75e6 / 8),
}
AXE = open('/root/ehr/backend/node_modules/axe-core/axe.min.js').read()

def timed(fn):
    t0 = time.perf_counter(); fn(); return (time.perf_counter() - t0) * 1000

def login(page, email):
    page.goto(BASE, wait_until='load')
    page.fill('input >> nth=0', email); page.fill('input[type=password]', PW)
    page.click('text=Sign in >> nth=-1'); page.wait_for_selector('.topbar')

def run_tasks(page, rep):
    out = {}
    out['T1 Sign in (clinician)'] = timed(lambda: login(page, 'bello@facility-b.ng'))
    def open_record():
        page.fill("input[placeholder='Search name or ID']", 'Chinwe'); page.click('text=Chinwe Amadi'); page.wait_for_selector('text=Hypertension')
        page.click('text=Hypertension, stage 2'); page.wait_for_selector('[data-testid=record-viewer] .alert.ok')
    out['T2 Find patient and open a record'] = timed(open_record)
    def add_record():
        page.fill("input[placeholder^='e.g. Malaria']", f'Malaria RDT, visit {rep}')
        page.fill('textarea', 'rdt: positive\ntemperature: 38.6 C\nplan: ACT for 3 days')
        page.click('text=Encrypt, store and anchor'); page.wait_for_selector('text=Hash anchored')
    out['T3 Add a clinical record'] = timed(add_record)
    page.click('text=Sign out')
    login(page, 'patient@example.ng')
    def grant():
        page.click('text=Consent & sharing')
        page.wait_for_function("document.querySelectorAll('select')[0] && document.querySelectorAll('select')[0].options.length > 2")
        opts = page.eval_on_selector('select >> nth=0', 's => [...s.options].map(o => [o.value, o.text])')
        page.select_option('select >> nth=0', [v for v, t in opts if 'Eke' in t][0])
        page.click('text=Grant access'); page.wait_for_selector('text=Consent recorded on ledger')
    out['T4 Patient grants consent'] = timed(grant)
    def audit():
        page.click('text=Access log'); page.wait_for_selector('text=Access record')
    out['T5 Patient views access log'] = timed(audit)
    page.click('text=Sign out')
    return out

result = {'system': LABEL, 'tasks': {}, 'accessibility': {}}
with sync_playwright() as p:
    b = p.chromium.launch()
    for prof, cond in PROFILES.items():
        samples = {}
        for rep in range(REPS):
            ctx = b.new_context(viewport={'width': 1366, 'height': 820}, bypass_csp=True)
            page = ctx.new_page()
            if cond:
                cdp = ctx.new_cdp_session(page)
                cdp.send('Network.enable'); cdp.send('Network.emulateNetworkConditions', cond)
            for k, v in run_tasks(page, rep).items():
                samples.setdefault(k, []).append(v)
            ctx.close()
        result['tasks'][prof] = {k: {'meanMs': round(st.mean(v)), 'sdMs': round(st.pstdev(v)), 'n': len(v)} for k, v in samples.items()}
        print(prof, json.dumps(result['tasks'][prof]))

    # accessibility audit (WCAG 2.1 A/AA rules) on the main screens
    ctx = b.new_context(viewport={'width': 1366, 'height': 820}, bypass_csp=True); page = ctx.new_page()
    def axe(name):
        page.add_script_tag(content=AXE)
        r = page.evaluate("async () => { const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa']}}); return r.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help})); }")
        result['accessibility'][name] = r
        print('axe', name, [(v['id'], v['impact'], v['nodes']) for v in r])
    page.goto(BASE); page.wait_for_selector('.login'); axe('Sign-in page')
    login(page, 'bello@facility-b.ng'); page.fill("input[placeholder='Search name or ID']", 'Chinwe'); page.click('text=Chinwe Amadi'); page.wait_for_selector('text=Hypertension'); axe('Clinician: patient records')
    page.click('text=Sign out'); login(page, 'patient@example.ng'); page.click('text=Consent & sharing'); page.wait_for_selector('text=Who can see my records'); axe('Patient: consent page')
    b.close()
json.dump(result, open(OUT, 'w'), indent=2)
