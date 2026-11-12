"""Hand-laid implementation architecture diagram (SVG -> PNG via sharp)."""
W, H = 1600, 1220
BR, BR_SOFT, INK, MUTED, LINE = "#0f6b4f", "#e3f1ec", "#1c2421", "#5d6b66", "#3d4a45"
AMBER, AMBER_SOFT, BLUE, BLUE_SOFT = "#8a5a00", "#fdf1dc", "#1d4f91", "#e6eef9"
parts = []
A = parts.append

def box(x, y, w, h, title, lines=(), fill=BR_SOFT, stroke=BR, bold=True, size=17, rx=8):
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
    n = 1 + len(lines)
    cy = y + h / 2 - (n - 1) * 11
    A(f'<text x="{x+w/2}" y="{cy+6}" text-anchor="middle" font-size="{size}" font-weight="{700 if bold else 400}" fill="{INK}">{title}</text>')
    for i, l in enumerate(lines):
        A(f'<text x="{x+w/2}" y="{cy+6+22*(i+1)}" text-anchor="middle" font-size="14" fill="{MUTED}">{l}</text>')

def db(x, y, w, h, title, lines=(), fill=BR_SOFT, stroke=BR):
    e = 12
    A(f'<path d="M{x},{y+e} a{w/2},{e} 0 0,0 {w},0 a{w/2},{e} 0 0,0 -{w},0 v{h-2*e} a{w/2},{e} 0 0,0 {w},0 v-{h-2*e}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
    box_text(x, y + 8, w, h, title, lines)

def box_text(x, y, w, h, title, lines):
    n = 1 + len(lines); cy = y + h / 2 - (n - 1) * 11
    A(f'<text x="{x+w/2}" y="{cy+6}" text-anchor="middle" font-size="16" font-weight="700" fill="{INK}">{title}</text>')
    for i, l in enumerate(lines):
        A(f'<text x="{x+w/2}" y="{cy+6+21*(i+1)}" text-anchor="middle" font-size="13.5" fill="{MUTED}">{l}</text>')

def layer(x, y, w, h, label, fill="#f6f8f7", stroke="#9fb5ac"):
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="1.4" stroke-dasharray="6 4"/>')
    A(f'<text x="{x+16}" y="{y+26}" font-size="15" font-weight="700" fill="{BR}" letter-spacing="0.4">{label}</text>')

def arrow(x1, y1, x2, y2, label=None, dashed=False, both=False, lx=None, ly=None, anchor="start"):
    d = ' stroke-dasharray="6 5"' if dashed else ''
    ms = ' marker-start="url(#ah)"' if both else ''
    A(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{LINE}" stroke-width="1.8"{d} marker-end="url(#ah)"{ms}/>')
    if label:
        tx = lx if lx is not None else (x1 + x2) / 2 + 10
        ty = ly if ly is not None else (y1 + y2) / 2
        for i, t in enumerate(label.split('|')):
            A(f'<text x="{tx}" y="{ty + 17*i}" font-size="13.5" fill="{INK}" text-anchor="{anchor}" font-style="italic">{t}</text>')

def path(d, label=None, lx=0, ly=0, dashed=False, anchor="start"):
    ds = ' stroke-dasharray="6 5"' if dashed else ''
    A(f'<path d="{d}" fill="none" stroke="{LINE}" stroke-width="1.8"{ds} marker-end="url(#ah)"/>')
    if label:
        for i, t in enumerate(label.split('|')):
            A(f'<text x="{lx}" y="{ly + 17*i}" font-size="13.5" fill="{INK}" text-anchor="{anchor}" font-style="italic">{t}</text>')

# ---------------- Presentation layer ----------------
layer(30, 20, 1540, 160, "PRESENTATION LAYER  ·  React 18 + TypeScript single-page app (Vite 5), runs in the user's browser")
for i, (t, l) in enumerate([("Patient dashboard", "my records · consent &amp; sharing · access log"),
                            ("Clinician dashboard", "enrol patient · records · break-glass access"),
                            ("Auditor dashboard", "integrity check · ledger history · audit trail"),
                            ("Admin dashboard", "staff accounts · facility identities")]):
    box(60 + i * 378, 60, 350, 92, t, [l])

arrow(800, 180, 800, 238, "HTTPS · JSON · JWT bearer token", lx=815, ly=214)

# ---------------- Application layer ----------------
layer(30, 240, 1540, 330, "APPLICATION LAYER  ·  Node.js 22 + Express 5 REST API written in TypeScript")
box(60, 285, 1480, 64, "Security middleware", ["Helmet headers  ·  CORS allow-list  ·  express-rate-limit  ·  JWT verification (HS256)  ·  role guard  ·  Zod input validation"])
arrow(800, 349, 800, 385)
box(560, 385, 480, 64, "REST controllers", ["/auth  /patients  /records  /consents  /audit  /staff"])
# three services
box(60, 480, 420, 70, "Data-access service", ["Mongoose 9 ODM · schemas &amp; validation"])
box(590, 480, 420, 70, "Crypto service", ["AES-256-GCM encrypt / decrypt · SHA-256 digest"])
box(1120, 480, 420, 70, "Ledger service", ["Fabric Gateway SDK 1.12 over gRPC"])
path("M640,449 L640,465 L270,465 L270,480")
arrow(800, 449, 800, 480)
path("M960,449 L960,465 L1330,465 L1330,480")

# ---------------- Data layer ----------------
layer(30, 610, 420, 590, "OFF-CHAIN STORAGE", fill="#fbf8f1", stroke="#d9c7a3")
db(70, 660, 340, 150, "MongoDB 7", ["users · patients", "medicalrecords (encrypted", "payload + SHA-256 + tx id)"], fill=AMBER_SOFT, stroke=AMBER)
A(f'<text x="240" y="860" text-anchor="middle" font-size="13.5" fill="{MUTED}">Bulky, frequently read data stays here,</text>')
A(f'<text x="240" y="880" text-anchor="middle" font-size="13.5" fill="{MUTED}">always encrypted at rest. Its integrity is</text>')
A(f'<text x="240" y="900" text-anchor="middle" font-size="13.5" fill="{MUTED}">proved by the hash held on the ledger.</text>')
path("M270,550 L270,660", "Mongoose", lx=282, ly=596)

# ---------------- Blockchain layer ----------------
layer(480, 610, 1090, 590, "BLOCKCHAIN LAYER  ·  Hyperledger Fabric 2.5 permissioned network · channel 'ehrchannel' · Docker", fill="#f3f6fb", stroke="#9fb3d4")
def org(x, name, sub, peer, couch, ca):
    A(f'<rect x="{x}" y="700" width="330" height="480" rx="10" fill="#ffffff" stroke="{BLUE}" stroke-width="1.4"/>')
    A(f'<text x="{x+165}" y="728" text-anchor="middle" font-size="16" font-weight="700" fill="{BLUE}">{name}</text>')
    A(f'<text x="{x+165}" y="748" text-anchor="middle" font-size="13.5" fill="{MUTED}">{sub}</text>')
    box(x + 30, 770, 270, 66, peer, ["endorsing &amp; committing peer"], fill=BLUE_SOFT, stroke=BLUE)
    box(x + 30, 880, 270, 74, "EHR chaincode v1.1", ["TypeScript · fabric-contract-api", "chaincode-as-a-service"], fill=BLUE_SOFT, stroke=BLUE)
    db(x + 55, 990, 220, 92, "CouchDB 3", ["world state + index"], fill=BLUE_SOFT, stroke=BLUE)
    box(x + 30, 1110, 270, 52, ca, [], fill="#ffffff", stroke=BLUE, size=15)
    A(f'<line x1="{x+165}" y1="836" x2="{x+165}" y2="880" stroke="{LINE}" stroke-width="1.6"/>')
    A(f'<line x1="{x+165}" y1="954" x2="{x+165}" y2="990" stroke="{LINE}" stroke-width="1.6"/>')
org(510, "Org1MSP  ·  Hospital A", "tertiary teaching hospital", "peer0.org1 :7051", "", "Fabric CA (Org1) :7054")
org(1210, "Org2MSP  ·  Facility B", "primary health centre", "peer0.org2 :9051", "", "Fabric CA (Org2) :8054")
box(875, 880, 300, 92, "Ordering service", ["Raft consensus", "orderer.example.com :7050"], fill=BLUE_SOFT, stroke=BLUE)
arrow(840, 803, 1010, 880, both=True)
arrow(1210, 803, 1040, 880, both=True)
A(f'<text x="1025" y="835" text-anchor="middle" font-size="13.5" fill="{INK}" font-style="italic">transactions → ordered blocks</text>')
box(875, 1030, 300, 62, "Membership Service Provider", ["X.509 identities per facility"], fill="#ffffff", stroke=BLUE, size=15)

# gRPC links from ledger service to peers
path("M1250,550 L1250,590 L790,590 L790,770", "gRPC/TLS: endorse · submit · evaluate", lx=805, ly=582)
path("M1490,550 L1490,770", "gRPC/TLS", lx=1500, ly=660)

# arrow marker + document
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{LINE}"/></marker></defs>
<rect width="{W}" height="{H}" fill="#ffffff"/>
{''.join(parts)}
</svg>'''
open('/root/ehr/figures/arch.svg', 'w').write(svg)
