"""Drives the real React UI through the referral scenario and captures screenshots for Chapter 4."""
import os, re, sys, time, subprocess, json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173"
OUT = "/root/ehr/screenshots/full"
PW = "Passw0rd!2026"
DB = "ehr_demo"
os.makedirs(OUT, exist_ok=True)

def shot(page, name):
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)
    print("shot", name)

def login(page, email):
    page.goto(BASE)
    page.fill("input >> nth=0", email)
    page.fill("input[type=password]", PW)
    page.click("text=Sign in >> nth=-1")
    page.wait_for_selector(".topbar")

def logout(page):
    page.click("text=Sign out")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1366, "height": 820}, device_scale_factor=1.5, bypass_csp=True)  # harness needs eval; the app itself runs under CSP

    # 1. login screen
    page.goto(BASE); page.fill("input >> nth=0", "bello@facility-b.ng"); shot(page, "01_login")

    # 2. PHC clinician sees her patient and records
    login(page, "bello@facility-b.ng")
    page.fill("input[placeholder='Search name or ID']", "Chinwe"); page.click("text=Chinwe Amadi"); page.wait_for_selector("text=Hypertension")
    shot(page, "02_clinician_patient_records")
    page.click("text=Hypertension, stage 2"); page.wait_for_selector("[data-testid=record-viewer] .alert.ok")
    shot(page, "03_record_opened_integrity_verified")
    logout(page)

    # 3. Hospital A doctor (referral) tries without consent -> denied
    login(page, "adeyemi@hospital-a.ng")
    page.fill("input[placeholder='Search name or ID']", "Chinwe"); page.click("text=Chinwe Amadi"); page.wait_for_selector("text=Hypertension")
    page.click("text=Hypertension, stage 2"); page.wait_for_selector("[data-testid=record-viewer] .alert")
    shot(page, "04_referral_access_denied_no_consent")
    logout(page)

    # 4. Patient grants consent to Dr Adeyemi
    login(page, "patient@example.ng")
    shot(page, "05_patient_my_records")
    page.click("text=Consent & sharing")
    page.wait_for_selector("select >> nth=0")
    page.wait_for_function("document.querySelectorAll('select')[0].options.length > 2")
    opts = page.eval_on_selector("select >> nth=0", "s => [...s.options].map(o => [o.value, o.text])")
    val = [v for v, t in opts if "Adeyemi" in t][0]
    page.select_option("select >> nth=0", val)
    page.click("text=Grant access"); page.wait_for_selector("text=Consent recorded on ledger")
    shot(page, "06_patient_grants_consent")
    logout(page)

    # 5. Dr Adeyemi now opens the record and adds a specialist note
    login(page, "adeyemi@hospital-a.ng")
    page.fill("input[placeholder='Search name or ID']", "Chinwe"); page.click("text=Chinwe Amadi"); page.wait_for_selector("text=Hypertension")
    page.click("text=Hypertension, stage 2"); page.wait_for_selector("[data-testid=record-viewer] .alert.ok")
    shot(page, "07_referral_access_allowed")
    page.fill("input[placeholder^='e.g. Malaria']", "Echocardiogram: mild LVH")
    page.fill("textarea", "finding: Mild left ventricular hypertrophy\nejectionFraction: 58%\nplan: Add lisinopril 10 mg, review in 6 weeks")
    page.click("text=Encrypt, store and anchor"); page.wait_for_selector("text=Hash anchored")
    shot(page, "08_specialist_adds_record")
    logout(page)

    # 6. Emergency (break-glass) access by an A&E doctor with no consent
    login(page, "eke@facility-b.ng")
    page.fill("input[placeholder='Search name or ID']", "Chinwe"); page.click("text=Chinwe Amadi"); page.wait_for_selector("text=Penicillin allergy")
    page.click("text=Penicillin allergy"); page.wait_for_selector("text=Break glass")
    page.fill("input[placeholder^='e.g. Unconscious']", "Unconscious patient brought into A&E after RTA; need allergy history before giving antibiotics")
    page.click("text=Break glass"); page.wait_for_selector("text=Opened under emergency access")
    shot(page, "10_emergency_break_glass")
    logout(page)

    # 7. Patient access log now shows denied, allowed and emergency events
    login(page, "patient@example.ng")
    page.click("text=Access log"); page.wait_for_selector("text=EMERGENCY")
    shot(page, "09_patient_access_log")
    logout(page)

    # 8. Insider tampers with an off-chain record directly in MongoDB
    js = "const r=db.medicalrecords.findOne({title:/Fasting blood sugar/}); const b=Buffer.from(r.sealed.ciphertext,'base64'); b[0]^=255; db.medicalrecords.updateOne({_id:r._id},{$set:{'sealed.ciphertext':b.toString('base64')}}); print(r.recordId)"
    rid = subprocess.check_output(["docker", "exec", "ehr-mongo", "mongosh", "--quiet", DB, "--eval", js]).decode().strip().splitlines()[-1]
    print("tampered", rid)
    login(page, "audit@hospital-a.ng")
    page.fill("input[placeholder^='Record ID']", rid); page.click("text=Verify against ledger"); page.wait_for_selector("text=TAMPERED")
    page.select_option("select >> nth=0", label=[o for o in page.eval_on_selector("select >> nth=0", "s => [...s.options].map(o => o.text)") if "Chinwe" in o][0])
    page.wait_for_selector("text=Access record")
    shot(page, "11_auditor_detects_tampering")
    logout(page)
    login(page, "bello@facility-b.ng")
    page.fill("input[placeholder='Search name or ID']", "Chinwe"); page.click("text=Chinwe Amadi"); page.wait_for_selector("text=Fasting blood sugar")
    page.click("text=Fasting blood sugar"); page.wait_for_selector("text=Integrity check failed")
    shot(page, "12_tampered_record_blocked")
    logout(page)

    # 9. Admin manages staff identities
    login(page, "admin@hospital-a.ng"); page.wait_for_selector("text=Clinicians on the network")
    shot(page, "13_admin_staff")

    b.close()
