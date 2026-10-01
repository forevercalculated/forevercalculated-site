#!/usr/bin/env python3
"""Forever Careers job refresh.
Keeps live roles, removes stale ones (not re-listed and older than MAX_AGE days), pulls fresh roles from Adzuna, Reed, ZipRecruiter and Jooble (US)
across all 19 countries, and leans the pull toward what signed-up members want (industries, countries,
work style) and what their CVs show, plus entry-level roles people are likely to land.
Usage: ADMIN_KEY=... python3 scripts/refresh_jobs.py   (run from the repo root)
"""
import json, re, os, sys, time, datetime, collections, urllib.request, urllib.parse, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ID = os.environ.get("ADZUNA_APP_ID", "6a6b424b"); APP_KEY = os.environ.get("ADZUNA_APP_KEY", "cc549e49d03b3da032d317a06c182eed")
ADMIN_KEY = os.environ.get("ADMIN_KEY", ""); SITE = "https://forevercalculatedcareers.com"
REED_KEY = os.environ.get("REED_KEY", "ccef8776-5275-4435-8fad-bc41a22464c6")
SOURCES = os.environ.get("SOURCES", "adzuna,reed,ziprecruiter,jooble").split(",")
JOOBLE_KEY = os.environ.get("JOOBLE_KEY", "22c1cc1d-497a-4b40-8820-36915c8a0006"); JOOBLE_ID_OFFSET = 3 * 10**12
JOOBLE_BUDGET = int(os.environ.get("JOOBLE_BUDGET", "150")); JOOBLE_TARGET = int(os.environ.get("JOOBLE_TARGET", "4000")); JOOBLE_SHARE = float(os.environ.get("JOOBLE_SHARE", "0.2"))
ZR_URL = "https://api.ziprecruiter.com/mcp"; ZR_ID_OFFSET = 2 * 10**12
ZR_MIN = int(os.environ.get("ZR_MIN", "1000")); ZR_TARGET = int(os.environ.get("ZR_TARGET", "1150")); ZR_CALLS = int(os.environ.get("ZR_CALLS", "320"))
ZR_SLEEP = float(os.environ.get("ZR_SLEEP", "3")); ZR_ONLY = os.environ.get("ZR_ONLY", "") == "1"
REED_BUDGET = int(os.environ.get("REED_BUDGET", "900"))
PRIMARY_SHARE = float(os.environ.get("PRIMARY_SHARE", "0.9"))  # share of roles kept for the countries most members are based in
PRIMARY = {"UK": 1.0}  # country -> weight; set in main() from member countries (each country with 10%+ of members)
REED_SHARE = float(os.environ.get("REED_SHARE", "0.45")); MIN_PER_COUNTRY = int(os.environ.get("MIN_PER_COUNTRY", "40")); REED_ID_OFFSET = 10**12
MAX_AGE = int(os.environ.get("MAX_AGE_DAYS", "21")); CAP = int(os.environ.get("CAP", "15000"))
CALL_BUDGET = int(os.environ.get("CALL_BUDGET", "180")); SLEEP = 2.6
TODAY = datetime.date.today()
TOPUP = os.environ.get("TOPUP", "") == "1"
MEMBERS_ONLY = os.environ.get("MEMBERS_ONLY", "") == "1"  # one-off: only the per-member targeted pull, then merge
MEMBER_HITS = set()  # ids found by per-member searches get a strong ranking boost
SENIOR_HITS = set()  # ids found for members with a senior profile (member_titles.json): exempt from the entry level filter
def _load(name, default):
    try: return json.load(open(os.path.join(ROOT, "scripts", name), encoding="utf-8"))
    except Exception: return default
MEMBER_TITLES = _load("member_titles.json", {})  # {email: {"titles": [...], "senior": true}} set by Kenneth for specific members
PINNED = _load("pinned_jobs.json", [])  # roles hand picked for specific members: always kept until they expire
SKILL_TITLES = [  # (pattern in CV / about text, titles to search)
    (r"computer science|it support|service desk|help ?desk|technical support|networking|comptia", ["it support", "service desk analyst", "helpdesk", "technical support", "1st line support"]),
    (r"data entry|records|data processing|typing", ["data entry", "records administrator", "data administrator"]),
    (r"data analy|excel|reporting|sql", ["junior data analyst", "reporting assistant", "data administrator"]),
    (r"reception|front desk|bookings", ["receptionist", "front of house", "bookings coordinator"]),
    (r"customer service|call cent|contact cent|customer support|dwp|advisor", ["customer service advisor", "customer support", "contact centre advisor", "live chat advisor"]),
    (r"admin|office|coordinator|clerk", ["administrator", "admin assistant", "office assistant"]),
    (r"care|support worker|healthcare|clinical|nhs|dental|patient", ["healthcare administrator", "patient services", "care coordinator", "medical receptionist"]),
    (r"sales|retail", ["sales advisor", "customer sales advisor", "retail assistant"]),
    (r"hr\b|human resources|recruit", ["hr assistant", "recruitment administrator", "recruitment resourcer"]),
    (r"account|finance|payroll|bookkeep", ["accounts assistant", "finance assistant", "payroll administrator"]),
]  # second pass: more Reed city searches and Jooble pages for target roles only
CC = {"UK":"gb","US":"us","CA":"ca","AU":"au","NZ":"nz","SG":"sg","ZA":"za","IN":"in","DE":"de","FR":"fr","NL":"nl","ES":"es","IT":"it","BE":"be","AT":"at","CH":"ch","PL":"pl","BR":"br","MX":"mx"}
TAG = {v:k for k,v in CC.items()}
def is_reed(j): return REED_ID_OFFSET <= j["id"] < ZR_ID_OFFSET
def is_zr(j): return ZR_ID_OFFSET <= j["id"] < JOOBLE_ID_OFFSET
def is_jooble(j): return j["id"] >= JOOBLE_ID_OFFSET
BROAD_PAGES = {"gb":16,"us":16,"ca":5,"au":5,"nz":3,"in":3,"de":3,"fr":3,"sg":2,"za":2,"nl":2,"es":2,"it":2,"be":2,"at":2,"ch":2,"pl":2,"br":2,"mx":2}
TARGET_Q = ["customer service advisor", "customer support", "call centre", "contact centre", "customer service", "customer success", "live chat",
    "administrator", "admin assistant", "office administrator", "receptionist", "data entry", "virtual assistant", "administrative assistant",
    "it support", "service desk", "help desk", "technical support", "1st line support", "desktop support",
    "accounts assistant", "finance assistant", "credit control", "payroll administrator", "bookkeeper", "hr assistant", "hr administrator",
    "recruitment resourcer", "sales advisor", "telesales", "sales development representative", "appointment setter", "lead generation",
    "claims handler", "insurance administrator", "complaints handler", "collections advisor", "marketing assistant", "social media assistant",
    "content moderator", "transcription", "care assistant", "support worker", "healthcare assistant", "online tutor", "trainee", "apprentice",
    "graduate", "junior", "entry level", "no experience"]
TARGET_RX = re.compile(r"customer|client service|call cent|contact cent|help ?desk|service desk|it support|technical support|tech support|1st line|first line|2nd line|second line|desktop support|it technician|support (agent|advisor|adviser|analyst|specialist|associate|representative|executive|officer|assistant|engineer|technician)|live chat|chat (agent|support)|data entry|data (administrator|clerk|processor)|junior data|admin|receptionist|secretary|personal assistant|virtual assistant|office (assistant|junior|coordinator)|coordinator|clerk|typist|transcri|moderat|telesales|telemarket|sales (advisor|adviser|assistant|associate|representative|executive|agent|development)|business development representative|lead generat|appointment setter|account(s)? (assistant|administrator|payable|receivable|clerk)|credit control|payroll|bookkeep|finance (assistant|administrator|clerk)|purchase ledger|sales ledger|hr (assistant|administrator|coordinator|advisor|adviser)|people (assistant|administrator)|recruitment (resourcer|administrator|coordinator|assistant)|resourcer|marketing (assistant|executive|coordinator)|social media|content (writer|assistant)|claims (handler|advisor|adviser|assistant)|underwriting assistant|insurance (advisor|adviser|administrator|assistant)|collections|debt (advisor|adviser)|complaints|onboarding|care assistant|healthcare assistant|care worker|carer|support worker|caregiver|tutor|teaching assistant|trainee|apprentice|graduate|entry level|junior|no experience|placement|intern|internship|student|part time|part-time|weekend|evening|retail assistant|sales assistant|store assistant|cashier|team member|booking|reservations|dispatcher|scheduler|order processor", re.I)
EXCLUDE_RX = re.compile(r"\b(senior|snr|sr\.?|lead|principal|head|director|chief|vp|vice president|partner|architect|manager|supervisor|superintendent|specialist nurse|nurse|doctor|physician|surgeon|dentist|pharmacist|solicitor|lawyer|attorney|barrister|paralegal|developer|software|devops|scientist|professor|lecturer|teacher|psychologist|therapist|surveyor|accountant|actuary|engineer(?!.{0,15}support)|driver|hgv|forklift|chef|welder|electrician|plumber|mechanic)\b", re.I)
KEEP_TITLE_RX = re.compile(r"\b(assistant manager|trainee manager|trainee|apprentice|graduate|junior|support engineer|desktop engineer|service desk engineer|it support engineer|1st line engineer|first line engineer)\b", re.I)
SAL_CAP = {"UK":40000,"US":75000,"CA":75000,"AU":90000,"NZ":80000,"SG":70000,"ZA":450000,"IN":1200000,"DE":55000,"FR":50000,"NL":55000,"ES":40000,"IT":40000,
           "BE":55000,"AT":55000,"CH":95000,"PL":150000,"BR":120000,"MX":400000}
def eligible(j):
    """Entry level only: target job families, no senior or specialist titles, no clearly high paid roles."""
    t = j.get("title") or ""
    if not TARGET_RX.search(t): return False
    if EXCLUDE_RX.search(t) and not KEEP_TITLE_RX.search(t): return False
    cap = SAL_CAP.get(j.get("country"))
    lo = j.get("salary_min") or 0
    if cap and lo and lo > cap: return False
    return True
def work_tier(j):
    loc = (j.get("location") or "").lower()
    if j.get("remote") or "remote" in loc: return 2
    if "hybrid" in loc: return 1
    return 0

ENTRY = ["customer service","call centre","customer support","administrator","admin assistant","receptionist","data entry","retail assistant",
         "warehouse operative","care assistant","support worker","entry level","trainee","graduate","apprentice","no experience","work from home","remote"]
IND_Q = {"Customer Service":["customer service advisor","call centre","customer support"],"Admin & Office":["administrator","office assistant","data entry"],
 "IT & Data":["it support","data analyst","service desk"],"Healthcare & Care":["care assistant","healthcare assistant","support worker"],
 "Finance & Accounting":["accounts assistant","finance assistant","bookkeeper"],"Sales & Marketing":["sales executive","marketing assistant","business development"],
 "Hospitality & Retail":["retail assistant","hospitality","barista"],"Warehouse, Logistics & Driving":["warehouse operative","delivery driver","logistics"],
 "Engineering & Construction":["engineer","electrician","construction"],"Education":["teaching assistant","tutor","teacher"],
 "HR & Recruitment":["recruitment consultant","hr assistant","recruiter"],"Open to anything":["entry level","trainee","no experience"]}
TITLE_VOCAB = ["customer service","customer support","call centre","contact centre","administrator","admin","receptionist","data entry","data analyst",
 "sales","retail","cashier","warehouse","picker","driver","delivery","care assistant","support worker","nurse","teaching assistant","tutor",
 "it support","service desk","help desk","developer","engineer","accountant","bookkeeper","marketing","social media","recruit","hr","chef","barista",
 "hospitality","security","cleaner","project","operations","logistics","finance","insurance","pricing","analyst"]
TAGMAP = {"it-jobs":"IT Support","customer-services-jobs":"Customer Service","admin-jobs":"Admin & Office","retail-jobs":"Retail","logistics-warehouse-jobs":"Warehouse & Logistics",
 "sales-jobs":"Sales","hospitality-catering-jobs":"Hospitality","healthcare-nursing-jobs":"Healthcare & Nursing","accounting-finance-jobs":"Finance & Accounting",
 "engineering-jobs":"Engineering","pr-advertising-marketing-jobs":"Marketing","teaching-jobs":"Education","trade-construction-jobs":"Construction","hr-jobs":"HR",
 "domestic-help-cleaning-jobs":"Cleaning","social-work-jobs":"Care & Support Work","scientific-qa-jobs":"Engineering","manufacturing-jobs":"Warehouse & Logistics",
 "travel-jobs":"Hospitality","consultancy-jobs":"Finance & Accounting","legal-jobs":"Admin & Office","energy-oil-gas-jobs":"Engineering","property-jobs":"Sales",
 "creative-design-jobs":"Marketing","graduate-jobs":"Graduate Schemes","maintenance-jobs":"Engineering","charity-voluntary-jobs":"Care & Support Work"}
RULES = [("Delivery & Driving",r"driver|delivery|courier"),("Customer Service",r"customer service|call cent|contact cent|customer support|help ?desk|receptionist"),
 ("Healthcare & Nursing",r"nurse|nursing|care assistant|carer|healthcare|clinical|pharmac"),("Care & Support Work",r"support worker|social worker|care worker"),
 ("Education",r"teacher|teaching|tutor|lecturer|school"),("Admin & Office",r"admin|administrator|office|secretary|coordinator|clerk|data entry"),
 ("Sales",r"sales|account manager|business development"),("Retail",r"retail|store|shop|cashier"),("Warehouse & Logistics",r"warehouse|logistic|forklift|picker|packer|operative"),
 ("Hospitality",r"chef|cook|kitchen|waiter|bartender|barista|hotel|housekeep|restaurant"),("Finance & Accounting",r"account|finance|payroll|bookkeep|tax"),
 ("IT Support",r"developer|software|data|devops|cloud|cyber|network|analyst"),("Engineering",r"engineer|technician|electrician|mechanic|maintenance"),
 ("Construction",r"construction|site manager|labourer|carpenter|joiner"),("Marketing",r"marketing|social media|content|designer"),("HR",r"\bhr\b|human resources|recruit"),("Cleaning",r"clean")]
RE_REMOTE = re.compile(r"\b(fully remote|100% remote|remote[- ]first|work from home|working from home|home[- ]based|homeworking|remote (role|position|job|working|opportunity)|wfh|télétravail|homeoffice|remoto)\b", re.I)
RE_HYBRID = re.compile(r"\b(hybrid|hybride|híbrido|ibrido)\b", re.I)

calls = 0
def adzuna(cc, page, what=None, days=14):
    global calls
    if calls >= CALL_BUDGET: return None
    q = {"app_id":APP_ID,"app_key":APP_KEY,"results_per_page":50,"sort_by":"date","max_days_old":days,"content-type":"application/json"}
    if what: q["what"] = what; q["what_exclude"] = "senior lead principal director head manager"
    url = "https://api.adzuna.com/v1/api/jobs/%s/search/%d?%s" % (cc, page, urllib.parse.urlencode(q))
    calls += 1
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"ForeverCareers/1.0"}), timeout=30) as r:
            d = json.loads(r.read().decode())
    except Exception as e:
        print("  adzuna error", cc, what, page, str(e)[:80], flush=True)
        if "429" in str(e): time.sleep(30)
        return []
    time.sleep(SLEEP)
    return d.get("results", [])

def to_job(r, cc, forced_cat=None):
    aid = r.get("id"); t = (r.get("title") or "").strip(); u = r.get("redirect_url")
    if not aid or not t or not u: return None
    tag = TAG[cc]; loc = (r.get("location") or {}).get("display_name") or tag
    text = t + " " + (r.get("description") or "") + " " + loc
    remote = bool(RE_REMOTE.search(text)) or bool(re.search(r"\bremote\b", t + " " + loc, re.I))
    if (not remote) and RE_HYBRID.search(text) and "hybrid" not in loc.lower(): loc += " (Hybrid)"
    pred = str(r.get("salary_is_predicted", "0")) == "1"
    cat = forced_cat or TAGMAP.get((r.get("category") or {}).get("tag", ""), "General")
    if cat == "General":
        tl = t.lower()
        for c, rx in RULES:
            if re.search(rx, tl): cat = c; break
    return {"id": int(aid), "title": t, "company": (r.get("company") or {}).get("display_name") or "Company not listed", "location": loc,
            "salary_min": 0 if pred else round(r.get("salary_min") or 0), "salary_max": 0 if pred else round(r.get("salary_max") or 0),
            "category": cat, "url": u, "country": tag, "remote": remote, "posted": (r.get("created") or "")[:10]}

MEMBER_CITIES = collections.Counter()
UK_CITIES = ["London","Manchester","Birmingham","Leeds","Glasgow","Liverpool","Bristol","Sheffield","Nottingham","Leicester","Newcastle","Cardiff","Edinburgh","Belfast","Southampton","Coventry","Reading","Milton Keynes"]
reed_calls = 0
def reed(keywords, skip=0, location=None):
    """Reed.co.uk Jobseeker API (UK). Returns up to 100 results."""
    global reed_calls
    if reed_calls >= REED_BUDGET: return None
    import base64
    params = {"keywords": keywords, "resultsToTake": 100, "resultsToSkip": skip}
    if location: params["locationName"] = location
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request("https://www.reed.co.uk/api/1.0/search?" + q,
        headers={"Authorization": "Basic " + base64.b64encode((REED_KEY + ":").encode()).decode(), "User-Agent": "ForeverCareers/1.0"})
    reed_calls += 1
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    except Exception as e:
        print("  reed error", keywords, str(e)[:80], flush=True); return []
    time.sleep(0.6)
    return d.get("results", [])

def dmy(s):
    try: return datetime.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except Exception: return ""

def reed_job(r):
    jid = r.get("jobId"); t = (r.get("jobTitle") or "").strip(); u = r.get("jobUrl")
    if not jid or not t or not u: return None
    expires = dmy(r.get("expirationDate", "")); posted = dmy(r.get("date", ""))
    if expires and expires < TODAY.isoformat(): return None
    if posted and posted < (TODAY - datetime.timedelta(days=30)).isoformat(): return None
    loc = r.get("locationName") or "UK"; text = t + " " + (r.get("jobDescription") or "") + " " + loc
    remote = bool(RE_REMOTE.search(text)) or bool(re.search(r"\bremote\b", t + " " + loc, re.I))
    if (not remote) and RE_HYBRID.search(text) and "hybrid" not in loc.lower(): loc += " (Hybrid)"
    cat = "General"; tl = t.lower()
    for c, rx in RULES:
        if re.search(rx, tl): cat = c; break
    return {"id": REED_ID_OFFSET + int(jid), "title": t, "company": r.get("employerName") or "Company not listed", "location": loc,
            "salary_min": round(r.get("minimumSalary") or 0), "salary_max": round(r.get("maximumSalary") or 0), "category": cat,
            "url": u, "country": "UK", "remote": remote, "posted": posted, "expires": expires, "source": "reed"}

# ---------------- Jooble (US only: this API key covers jooble.org) ----------------
jooble_calls = 0; jooble_errors = 0
def jooble(keywords, page=1, location=""):
    global jooble_calls, jooble_errors
    if jooble_calls >= JOOBLE_BUDGET or jooble_errors >= 5: return None
    body = json.dumps({"keywords": keywords, "location": location, "page": str(page), "ResultOnPage": "100"}).encode()
    req = urllib.request.Request("https://jooble.org/api/" + JOOBLE_KEY, data=body, headers={"Content-Type": "application/json", "User-Agent": "ForeverCareers/1.0"})
    jooble_calls += 1
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=40).read().decode())
    except Exception as e:
        jooble_errors += 1; print("  jooble error", keywords, page, str(e)[:80], flush=True); time.sleep(5); return []
    time.sleep(1.0)
    return d.get("jobs") or []

def jooble_salary(s):
    s = (s or "").lower().replace(",", "")
    nums = [float(n) * (1000 if k else 1) for n, k in re.findall(r"\$?(\d+(?:\.\d+)?)\s*(k)?", s)]
    if not nums: return 0, 0
    mult = 2080 if "hour" in s else (12 if "month" in s else (52 if "week" in s else 1))
    lo, hi = nums[0] * mult, (nums[1] if len(nums) > 1 else nums[0]) * mult
    if lo < 5000: return 0, 0
    return round(lo), round(hi)

def jooble_job(r):
    t = re.sub(r"<[^>]+>|&nbsp;", " ", r.get("title") or ""); t = re.sub(r"\s+", " ", t).strip(); u = r.get("link"); jid = r.get("id")
    if not t or not u or jid is None: return None
    loc = (r.get("location") or "").strip() or "United States"
    if re.search(r"united kingdom|england|scotland|wales|ireland|india|australia|germany|france", loc, re.I): return None
    posted = (r.get("updated") or "")[:10]
    if posted and posted < (TODAY - datetime.timedelta(days=MAX_AGE)).isoformat(): return None
    country = "CA" if CA_RX.search(loc) else "US"
    text = t + " " + re.sub(r"<[^>]+>", " ", r.get("snippet") or "") + " " + loc + " " + (r.get("type") or "")
    remote = bool(RE_REMOTE.search(text)) or bool(re.search(r"\bremote\b", t + " " + loc, re.I))
    if remote and "remote" not in loc.lower(): loc += " (Remote)"
    elif (not remote) and RE_HYBRID.search(text) and "hybrid" not in loc.lower(): loc += " (Hybrid)"
    lo, hi = jooble_salary(r.get("salary"))
    cat = "General"; tl = t.lower()
    for c, rx in RULES:
        if re.search(rx, tl): cat = c; break
    return {"id": JOOBLE_ID_OFFSET + abs(int(jid)) % (10**11), "title": t, "company": (r.get("company") or "").strip() or "Company not listed", "location": loc,
            "salary_min": lo, "salary_max": hi, "category": cat, "url": u, "country": country, "remote": remote, "posted": posted or TODAY.isoformat(), "source": "jooble"}

JOOBLE_Q = ["remote customer service", "customer service", "remote customer support", "call center", "remote data entry", "data entry",
            "administrative assistant", "remote administrative assistant", "virtual assistant", "receptionist", "help desk", "it support", "remote it support",
            "technical support", "service desk", "chat support", "bookkeeper", "accounts payable clerk", "payroll clerk", "hr assistant", "sales development representative",
            "appointment setter", "insurance customer service", "claims processor", "caregiver", "entry level remote", "work from home", "no experience remote"]

def jooble_pull(member_q, want):
    got = {}
    queries = list(dict.fromkeys([q for q in member_q if len(q) > 2] + JOOBLE_Q))
    for q in queries:
        if len(got) >= want: break
        for page in ((1, 2, 3, 4, 5) if TOPUP else (1, 2, 3)):
            res = jooble(q, page)
            if res is None: return got
            new = 0
            for r in res:
                j = jooble_job(r)
                if j and j["id"] not in got: got[j["id"]] = j; new += 1
            if len(res) < 100 or new < (3 if TOPUP else 10) or len(got) >= want: break
    return got

# ---------------- ZipRecruiter (US and Canada) via its public MCP endpoint ----------------
zr_calls = 0; zr_blocked = False; zr_sid = None
CA_RX = re.compile(r",\s*(Ontario|Quebec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|Prince Edward Island|Yukon|Northwest Territories|Nunavut|ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\b")
def _zr_post(body, sid=None):
    hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": "ForeverCareers/1.0"}
    if sid: hdr["mcp-session-id"] = sid
    req = urllib.request.Request(ZR_URL, data=json.dumps(body).encode(), headers=hdr, method="POST")
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read().decode("utf-8", "replace"); new_sid = r.headers.get("mcp-session-id")
    if raw.lstrip().startswith("event:") or "\ndata:" in raw or raw.startswith("data:"):
        datas = [ln[5:].strip() for ln in raw.splitlines() if ln.startswith("data:")]
        raw = datas[-1] if datas else "{}"
    return (json.loads(raw) if raw.strip() else {}), new_sid

def zr_session():
    global zr_sid
    d, sid = _zr_post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "forevercareers-refresh", "version": "1"}}})
    zr_sid = sid
    try: _zr_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, zr_sid)
    except Exception: pass

def zr_search(args):
    """One search_jobs call (5 results). Paced, retries on 429 with backoff. Returns list, [] on error, None when blocked/over budget."""
    global zr_calls, zr_blocked, zr_sid
    if zr_blocked or zr_calls >= ZR_CALLS: return None
    for attempt in range(4):
        try:
            if zr_sid is None: zr_session()
            zr_calls += 1
            d, _ = _zr_post({"jsonrpc": "2.0", "id": zr_calls + 1, "method": "tools/call", "params": {"name": "search_jobs", "arguments": args}}, zr_sid)
            time.sleep(ZR_SLEEP)
            res = d.get("result") or {}
            payload = res.get("structuredContent")
            if not payload:
                for c in res.get("content") or []:
                    if c.get("type") == "text":
                        try: payload = json.loads(c["text"]); break
                        except Exception: pass
            if isinstance(payload, dict) and "results" not in payload and isinstance(payload.get("structuredContent"), dict):
                payload = payload["structuredContent"]
            return (payload or {}).get("results") or []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 30 * (attempt + 1); print("  ziprecruiter 429, waiting", wait, "s", flush=True); time.sleep(wait); zr_sid = None; continue
            if e.code in (400, 404, 410): zr_sid = None
            print("  ziprecruiter error", e.code, flush=True); time.sleep(5)
        except Exception as e:
            print("  ziprecruiter error", str(e)[:80], flush=True); zr_sid = None; time.sleep(5)
    zr_blocked = True; print("  ziprecruiter unavailable after retries; continuing without it", flush=True)
    return None

def zr_job(r):
    t = (r.get("title") or "").strip(); u = r.get("job_redirect_url"); comp = (r.get("company") or "").strip() or "Company not listed"
    if not t or not u: return None
    loc = (r.get("location") or "").strip()
    if not loc or loc.lower() == "location not specified": loc = "United States"
    country = "CA" if CA_RX.search(loc) else "US"
    remote = bool(r.get("is_remote")) or bool(re.search(r"\bremote\b", t, re.I))
    jt = r.get("job_type") or ""
    if remote and "remote" not in loc.lower(): loc += " (Remote)"
    elif (not remote) and "hybrid" in jt.lower() and "hybrid" not in loc.lower(): loc += " (Hybrid)"
    sal = r.get("salary") or {}
    try: posted = (TODAY - datetime.timedelta(days=int(r.get("days_ago") or 0))).isoformat()
    except Exception: posted = TODAY.isoformat()
    cat = "General"; tl = t.lower()
    for c, rx in RULES:
        if re.search(rx, tl): cat = c; break
    import hashlib
    key = re.sub(r"[^a-z0-9]", "", (t + "|" + comp + "|" + loc).lower())
    jid = ZR_ID_OFFSET + int(hashlib.sha1(key.encode()).hexdigest()[:12], 16) % (10**11)
    return {"id": jid, "title": t, "company": comp, "location": loc, "salary_min": round(sal.get("min_annual") or 0), "salary_max": round(sal.get("max_annual") or 0),
            "category": cat, "url": u, "country": country, "remote": remote, "posted": posted, "source": "ziprecruiter"}

ZR_Q = ["customer service representative", "administrative assistant", "data entry", "receptionist", "medical assistant", "registered nurse",
        "caregiver", "warehouse associate", "retail sales associate", "delivery driver", "it support", "help desk", "sales representative",
        "accounting clerk", "bookkeeper", "office manager", "call center", "virtual assistant", "project coordinator", "recruiter",
        "teacher", "cashier", "security officer", "cleaner", "cook", "marketing coordinator", "hr assistant", "logistics coordinator",
        "entry level", "work from home"]

def zr_pull(member_q, want):
    """Collect at least ZR_MIN unique US/Canada roles: member queries first (remote and any), then broad US titles."""
    got = {}
    queries = list(dict.fromkeys([q for q in member_q if len(q) > 2] + ZR_Q))
    plans = []
    for q in queries:
        plans.append({"job_role": q, "location_types": ["REMOTE"]})
        plans.append({"job_role": q})
    for base in plans:
        if len(got) >= want: break
        for page in range(8):  # up to 40 roles per search
            args = dict(base, offset=page * 5, max_posted_minutes_ago=60 * 24 * 14)
            res = zr_search(args)
            if res is None: return got
            new = 0
            for r in res:
                j = zr_job(r)
                if j and j["id"] not in got: got[j["id"]] = j; new += 1
            if len(res) < 5 or new == 0 or len(got) >= want: break
    return got

def admin(view):
    if not ADMIN_KEY: return None
    try:
        req = urllib.request.Request(SITE + "/api/admin?view=" + view, headers={"x-admin-key": ADMIN_KEY})
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as e:
        print("  admin feed error", view, str(e)[:80]); return None

def member_signals():
    """Industries, countries, work style from sign-ups; job-title words from uploaded CVs."""
    inds, ctys, work, cvwords = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    global MEMBER_CITIES
    su = admin("signups") or {}
    for r in su.get("rows", []):
        if re.search(r"example\.com|forevercareers-test", r.get("email", ""), re.I): continue
        if r.get("industry"): inds[r["industry"]] += 1
        lc = r.get("looking_in", ""); m = re.search(r"\b([A-Z]{2})$", lc)
        if m and m.group(1) in CC: ctys[m.group(1)] += 1
        if r.get("work_pref"): work[r["work_pref"]] += 1
        cm = re.match(r"\s*([A-Za-z .'-]{3,40}),\s*[A-Z]{2}$", lc or "")
        if cm: MEMBER_CITIES[cm.group(1).strip().title()] += 1
    al = admin("alerts") or {}
    try:
        from pypdf import PdfReader
    except Exception:
        PdfReader = None
    for m in (al.get("rows") or [])[:40]:
        if re.search(r"example\.com|forevercareers-test", m.get("email", ""), re.I): continue
        if m.get("industry"): inds[m["industry"]] += 2
        if m.get("country") in CC: ctys[m["country"]] += 2
        if not PdfReader or not str(m.get("cv_name", "")).lower().endswith(".pdf"): continue
        try:
            req = urllib.request.Request(SITE + m["cv_download"] + "&k=" + ADMIN_KEY)
            raw = urllib.request.urlopen(req, timeout=30).read()
            txt = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages).lower()
            for w in TITLE_VOCAB:
                if w in txt: cvwords[w] += 1
        except Exception as e:
            print("  cv read error", str(e)[:60])
    return inds, ctys, work, cvwords

ENTRY_RX = re.compile(r"\b(assistant|advisor|adviser|agent|operative|trainee|apprentice|graduate|junior|entry|associate|representative|administrator|receptionist|support worker|carer|team member|crew|cashier|picker|packer|driver|cleaner|coordinator)\b", re.I)
SENIOR_RX = re.compile(r"\b(senior|sr\.?|lead|principal|head of|director|architect|chief|vp|partner|staff engineer|consultant surgeon)\b", re.I)

def member_profiles():
    """One profile per active member on the job alerts list: search titles from their industry, CV and about text; part time and student flags; city."""
    al = admin("alerts") or {}
    try:
        from pypdf import PdfReader
    except Exception:
        PdfReader = None
    out = []
    for m in (al.get("rows") or [])[:60]:
        if m.get("access") != "active" or re.search(r"example\.com|forevercareers-test", m.get("email", ""), re.I): continue
        txt = (m.get("about") or "") + " " + (m.get("industry") or "")
        if PdfReader and str(m.get("cv_name", "")).lower().endswith(".pdf"):
            try:
                raw = urllib.request.urlopen(urllib.request.Request(SITE + m["cv_download"] + "&k=" + ADMIN_KEY), timeout=30).read()
                txt += " " + " ".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages)
            except Exception as e:
                print("  cv read error", str(e)[:60])
        low = txt.lower()
        titles = list(IND_Q.get(m.get("industry") or "", []))
        for rx, ts in SKILL_TITLES:
            if re.search(rx, low): titles += ts
        titles = [t for t in dict.fromkeys(titles) if t not in ("entry level", "trainee", "no experience")][:8]
        ov = MEMBER_TITLES.get((m.get("email") or "").lower())
        if ov: titles = list(ov.get("titles") or titles)[:10]
        part = bool(re.search(r"part[ -]?time|flexible|zero[ -]?hours|alongside (my )?(studies|university|degree)", low))
        student = bool(re.search(r"student|undergraduate|studying|university", (m.get("about") or "").lower()))
        out.append({"senior": bool(ov and ov.get("senior")), "email": m.get("email"), "titles": titles, "part": part, "student": student, "city": (m.get("city") or "").strip(),
                    "country": m.get("country") or "UK", "work": m.get("work_pref") or ""})
    return out

def member_pull(profiles, add_adzuna, fresh):
    """Targeted searches for every member: their titles, remote first, part time and student variants, near their city."""
    before = len(fresh)
    for pr in profiles:
        qs = []
        for t in pr["titles"]:
            qs.append(t + " remote")
            if pr["part"]: qs.append(t + " part time")
            if pr["work"] in ("hybrid", "any", "onsite"): qs.append(t + " hybrid")
        if pr["student"]: qs += ["student " + pr["titles"][0] if pr["titles"] else "student", "placement", "internship", "part time student"]
        qs = list(dict.fromkeys(qs))[:14]
        uk = pr["country"] in ("UK", "")
        for q in qs:
            if "reed" in SOURCES and uk:
                for skip in (0, 100):
                    res = reed(q, skip, pr["city"] if (pr["city"] and pr["work"] != "remote" and "remote" not in q) else None)
                    for r in res or []:
                        j = reed_job(r)
                        if j:
                            fresh.setdefault(j["id"], j); MEMBER_HITS.add(j["id"])
                            if pr.get("senior"): SENIOR_HITS.add(j["id"])
                    if not res or len(res) < 100: break
            if add_adzuna:
                cc = CC.get(pr["country"], "gb")
                for r in adzuna(cc, 1, q) or []:
                    j = to_job(r, cc)
                    if j: fresh.setdefault(j["id"], j); MEMBER_HITS.add(j["id"])
            if "jooble" in SOURCES and pr["country"] in ("US", "CA", "ANY", "OTHER"):
                for r in jooble(q, 1) or []:
                    j = jooble_job(r)
                    if j: fresh.setdefault(j["id"], j); MEMBER_HITS.add(j["id"])
        print("  member pull", pr["email"].split("@")[0][:4] + "***", "titles", pr["titles"][:4], "part", pr["part"], "student", pr["student"], flush=True)
    print("member pull added:", len(fresh) - before, "| member hits", len(MEMBER_HITS), flush=True)

def primary_countries(ctys):
    tot = sum(ctys.values())
    if not tot: return {"UK": 1.0}
    p = {c: n / tot for c, n in ctys.items() if n / tot >= 0.1}
    t = sum(p.values()) or 1
    return {c: v / t for c, v in p.items()} or {"UK": 1.0}

def fit_scorer(inds, ctys, work, cvwords):
    terms = []
    for ind, _ in inds.most_common(5): terms += IND_Q.get(ind, [])
    terms += [w for w, _ in cvwords.most_common(10)]
    terms = [t for t in dict.fromkeys(terms) if len(t) > 2]
    rx = re.compile("|".join(re.escape(t) for t in terms), re.I) if terms else None
    total_c = sum(ctys.values()) or 1
    want_remote = work.get("Remote", 0) > 0
    newest = TODAY.toordinal()
    def score(j):
        t = j["title"]; sc = 0.0
        if rx and rx.search(t + " " + j.get("category", "")): sc += 3
        if ENTRY_RX.search(t) and not SENIOR_RX.search(t): sc += 2
        if SENIOR_RX.search(t): sc -= 3
        if j.get("salary_min") or j.get("salary_max"): sc += 1
        sc += 3 * work_tier(j)  # fully remote first, then hybrid
        if j["id"] in MEMBER_HITS: sc += 5  # found by a search for a real member's skills: always keep
        sc += 1.5 * ctys.get(j.get("country"), 0) / total_c
        try: age = newest - datetime.date.fromisoformat(j.get("posted") or "2000-01-01").toordinal()
        except Exception: age = 30
        sc += max(0, 1 - age / 21)
        return sc
    return score

def dedupe(jobs, score):
    """One listing per title + company + country; prefer Reed (salary shown more often), then higher fit."""
    best = {}
    for j in jobs:
        key = (re.sub(r"[^a-z0-9]", "", j["title"].lower()), re.sub(r"[^a-z0-9]", "", j["company"].lower()), j["country"])
        rank = (2 if is_reed(j) else (1 if (is_zr(j) or is_jooble(j)) else 0), score(j), j.get("posted") or "")
        if key not in best or rank > best[key][0]: best[key] = (rank, j)
    return [v[1] for v in best.values()]

def select(jobs, score):
    """PRIMARY_SHARE of roles from the countries members are based in (split by member weight), the rest from other
    countries (ZipRecruiter first, up to ZR_MIN). If the primary pool is short, the total shrinks so the share still holds."""
    jobs = sorted(jobs, key=score, reverse=True)
    p_target = int(CAP * PRIMARY_SHARE)
    chosen, ids = [], set()
    for c, w in sorted(PRIMARY.items(), key=lambda x: -x[1]):
        want = int(round(p_target * w))
        pick = [j for j in jobs if j["country"] == c][:want]
        chosen += pick; ids.update(j["id"] for j in pick)
    if len(chosen) < p_target:  # top up from any primary country
        extra = [j for j in jobs if j["country"] in PRIMARY and j["id"] not in ids][:p_target - len(chosen)]
        chosen += extra; ids.update(j["id"] for j in extra)
    n_p = len(chosen)
    o_target = min(CAP - n_p, int(n_p * (1 - PRIMARY_SHARE) / PRIMARY_SHARE)) if PRIMARY_SHARE < 1 else 0
    others = [j for j in jobs if j["country"] not in PRIMARY]
    zr_j = [j for j in others if is_zr(j)][:min(ZR_MIN, o_target)]
    rest = [j for j in others if not is_zr(j)][:o_target - len(zr_j)]
    chosen += zr_j + rest
    return chosen

def load_current():
    s = open(os.path.join(ROOT, "netlify/lib/jobs-data.mjs"), encoding="utf-8").read()
    data = json.loads(re.match(r"export default (\[.*\]);?\s*$", s, re.S).group(1))
    h = open(os.path.join(ROOT, "public/index.html"), encoding="utf-8").read()
    i = h.find("const JOBS = ["); st = i + len("const JOBS = "); d = 0; k = st
    while True:
        c = h[k]
        if c == "[": d += 1
        elif c == "]":
            d -= 1
            if d == 0: k += 1; break
        k += 1
    pub = {j["id"]: j for j in json.loads(h[st:k])}
    for j in data:
        p = pub.get(j["id"], {}); j["posted"] = p.get("posted", ""); j["remote"] = p.get("remote", False)
    return data

def write_outputs(jobs, added, removed, member_q, keep_refreshed=None):
    # write outputs
    data = [dict({k: j[k] for k in ("id","title","company","location","salary_min","salary_max","category","url","country")}, **({"expires": j["expires"]} if j.get("expires") else {})) for j in jobs]
    open(os.path.join(ROOT, "netlify/lib/jobs-data.mjs"), "w", encoding="utf-8").write("export default " + json.dumps(data, ensure_ascii=False) + ";\n")
    meta = {"refreshed": keep_refreshed or datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "source": " + ".join(x for x, on in (("Adzuna", True), ("Reed", "reed" in SOURCES or any(is_reed(j) for j in jobs)), ("ZipRecruiter", any(is_zr(j) for j in jobs)), ("Jooble", any(is_jooble(j) for j in jobs))) if on),
            "total": len(jobs), "per_country": dict(collections.Counter(j["country"] for j in jobs)),
            "newest_posted": max((j.get("posted") or "") for j in jobs), "oldest_posted": min((j.get("posted") or "9999") for j in jobs),
            "added": added, "removed": removed, "member_queries": member_q}
    open(os.path.join(ROOT, "netlify/lib/jobs-meta.mjs"), "w").write("export default " + json.dumps(meta) + ";\n")
    pub = [{k: v for k, v in j.items() if k not in ("url", "expires", "source")} for j in jobs]
    p = os.path.join(ROOT, "public/index.html"); h = open(p, encoding="utf-8").read()
    i = h.find("const JOBS = ["); st = i + len("const JOBS = "); d = 0; k = st
    while True:
        c = h[k]
        if c == "[": d += 1
        elif c == "]":
            d -= 1
            if d == 0: k += 1; break
        k += 1
    h = h[:st] + json.dumps(pub, ensure_ascii=False) + h[k:]
    if any(is_zr(j) for j in jobs) and ">ZipRecruiter</a>" not in h:
        bq = '"'
        zr_link = " and <a href=" + bq + "https://www.ziprecruiter.com" + bq + " target=" + bq + "_blank" + bq + " rel=" + bq + "noopener" + bq + " style=" + bq + "color:inherit" + bq + ">ZipRecruiter</a>"
        h = h.replace("Adzuna</a> and <a href=" + bq + "https://www.reed.co.uk", "Adzuna</a>, <a href=" + bq + "https://www.reed.co.uk", 1)
        h = h.replace(">reed.co.uk</a>'", ">reed.co.uk</a>" + zr_link + "'", 1)
    if any(is_jooble(j) for j in jobs) and ">Jooble</a>" not in h:
        a = h.find('Jobs from <a href="https://www.adzuna'); b = h.find("; bp.parentNode", a)
        if a > 0 and b > a:
            seg = h[a:b]; q = re.search(r"\\?'$", seg); tail = q.group(0) if q else ""; body = seg[:len(seg) - len(tail)]
            links = re.findall(r"<a [^>]*>[^<]*</a>", body)
            links.append('<a href="https://jooble.org" target="_blank" rel="noopener" style="color:inherit">Jooble</a>')
            h = h[:a] + "Jobs from " + ", ".join(links[:-1]) + " and " + links[-1] + tail + h[b:]
    h = re.sub(r"const FC_JOBS_UPDATED = '[0-9-]*';", "const FC_JOBS_UPDATED = '%s';" % TODAY.isoformat(), h)
    open(p, "w", encoding="utf-8").write(h)
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(h)
    return meta

def zr_only(current, member_q, t0):
    """One-off: add ZipRecruiter roles to the live list without a full refresh. Keeps every current role and keeps the
    'refreshed' date unchanged, so the 3-day refresh clock is not reset."""
    zr = zr_pull(member_q, ZR_TARGET)
    print("ziprecruiter pulled:", len(zr), "| zr calls", zr_calls, "| blocked:", zr_blocked, flush=True)
    base = [j for j in current if not is_zr(j)]
    jobs = base + list(zr.values())
    jobs.sort(key=lambda j: (j.get("posted") or ""), reverse=True)
    old = open(os.path.join(ROOT, "netlify/lib/jobs-meta.mjs")).read()
    m = re.search(r'"refreshed":\s*"([^"]+)"', old)
    write_outputs(jobs, len(zr), 0, member_q, keep_refreshed=m.group(1) if m else None)
    report = {"total": len(jobs), "ziprecruiter_jobs": len(zr), "ziprecruiter_calls": zr_calls, "ziprecruiter_blocked": zr_blocked, "mode": "ziprecruiter_only",
              "refreshed_kept": m.group(1) if m else None, "per_country": dict(collections.Counter(j["country"] for j in jobs)), "minutes": round((time.time() - t0) / 60, 1)}
    print("REPORT " + json.dumps(report), flush=True)

def main():
    t0 = time.time()
    current = load_current()
    print("current jobs:", len(current), flush=True)
    inds, ctys, work, cvwords = member_signals()
    print("member industries:", dict(inds.most_common(6)), "| countries:", dict(ctys.most_common(5)), "| work:", dict(work), "| cv words:", dict(cvwords.most_common(8)), flush=True)
    fresh = {}
    def add(results, cc, forced=None):
        n = 0
        for r in results or []:
            j = to_job(r, cc, forced)
            if j and j["id"] not in fresh: fresh[j["id"]] = j; n += 1
        return n
    # 1) what members want and what their CVs show (highest priority)
    member_q = []
    for ind, _ in inds.most_common(4): member_q += IND_Q.get(ind, [])
    for w, _ in cvwords.most_common(6): member_q.append(w)
    if work.get("Remote"): member_q += ["remote", "work from home"]
    member_q = list(dict.fromkeys(member_q))[:14]
    global PRIMARY, JOOBLE_TARGET, JOOBLE_BUDGET
    PRIMARY = primary_countries(ctys)
    print("primary countries:", PRIMARY, "| share", PRIMARY_SHARE, flush=True)
    if "US" not in PRIMARY and "CA" not in PRIMARY: JOOBLE_TARGET = min(JOOBLE_TARGET, 800); JOOBLE_BUDGET = min(JOOBLE_BUDGET, 40)
    target_cc = [CC[c] for c in PRIMARY if c in CC] or ["gb"]
    if ZR_ONLY: return zr_only(current, member_q, t0)
    profiles = member_profiles()
    print("member profiles:", len(profiles), flush=True)
    member_pull(profiles, "adzuna" in SOURCES and CALL_BUDGET > 0, fresh)
    if MEMBERS_ONLY: SOURCES[:] = []
    if "adzuna" not in SOURCES: member_q_adz = []
    else: member_q_adz = member_q
    for q in member_q_adz:
        for cc in target_cc:
            got = add(adzuna(cc, 1, q), cc); print("  member", cc, q, "+", got, flush=True)
    # 2) target entry level roles: remote first, then hybrid, then any, in the UK and US; remote in other English speaking countries
    for q in (TARGET_Q if "adzuna" in SOURCES else []):
        for cc, variants in tuple(x for x in (("gb", ("remote", "hybrid", "")), ("us", ("remote", ""))) if TAG[x[0]] in PRIMARY):
            for v in variants:
                if add(adzuna(cc, 1, (q + " " + v).strip()), cc) is None: break
    for q in (["remote customer service", "remote administrator", "remote data entry", "remote it support", "work from home"] if "adzuna" in SOURCES else []):
        for cc in (c for c in ("ca", "au", "nz", "in", "sg", "za") if TAG[c] in PRIMARY):
            add(adzuna(cc, 1, q), cc)
    print("after member + entry-level:", len(fresh), "| calls", calls, flush=True)
    # 3) broad newest roles (small, only if budget remains; non matching titles are filtered out later)
    for cc, pages in (tuple((CC[c], 30) for c in PRIMARY if c in CC) if "adzuna" in SOURCES else []):
        for p in range(1, pages + 1):
            res = adzuna(cc, p)
            if res is None: break
            add(res, cc)
            if len(res) < 50: break
    # 4) Reed (UK): member queries first, then entry-level and broad UK keywords
    if "reed" in SOURCES:
        reed_q = [q + " remote" for q in member_q[:8]] + member_q + [q + " remote" for q in TARGET_Q[:25]] + [q + " hybrid" for q in TARGET_Q[:15]] + TARGET_Q
        reed_q = list(dict.fromkeys(reed_q))
        if TOPUP: reed_q = []
        n0 = len(fresh)
        for q in reed_q:
            for skip in (0, 100, 200):
                res = reed(q, skip)
                if res is None: break
                for r in res:
                    j = reed_job(r)
                    if j and j["id"] not in fresh: fresh[j["id"]] = j
                if len(res) < 100: break
            if reed_calls >= REED_BUDGET: break
        # city sweep: members' own cities first, then major UK cities, for the top member queries
        cities = [c for c, _ in MEMBER_CITIES.most_common(5)] + UK_CITIES
        if TOPUP: cities += ["Enfield", "Grays", "Croydon", "Watford", "Luton", "Chelmsford", "Brighton", "Oxford", "Cambridge", "Norwich", "Ipswich", "Peterborough", "Northampton", "Derby", "Stoke", "Wolverhampton", "Bradford", "Hull", "York", "Preston", "Bolton", "Swansea", "Aberdeen", "Dundee", "Plymouth", "Exeter", "Portsmouth", "Bournemouth", "Swindon", "Gloucester", "Sunderland", "Middlesbrough", "Warrington", "Stockport", "Slough", "Basildon", "Harlow", "Stevenage", "Crawley", "Maidstone"]
        cities = list(dict.fromkeys(cities))
        sweep_q = list(dict.fromkeys(member_q[:4] + ["customer service", "administrator", "receptionist", "data entry"]))
        if TOPUP: sweep_q = ["customer service", "administrator", "receptionist", "customer support", "call centre", "admin assistant", "accounts assistant", "sales advisor", "support worker", "care assistant", "it support", "trainee"]
        for city in cities:
            for q in sweep_q:
                res = reed(q, 0, city)
                if res is None: break
                for r in res:
                    j = reed_job(r)
                    if j and j["id"] not in fresh: fresh[j["id"]] = j
            if reed_calls >= REED_BUDGET: break
        print("reed added:", len(fresh) - n0, "| reed calls", reed_calls, "| member cities:", dict(MEMBER_CITIES.most_common(5)), flush=True)
    # 5) ZipRecruiter (US and Canada): at least ZR_MIN roles, member queries first
    if "ziprecruiter" in SOURCES:
        zr = zr_pull(member_q, ZR_TARGET)
        for jid, j in zr.items(): fresh[jid] = j
        print("ziprecruiter added:", len(zr), "| zr calls", zr_calls, "| blocked:", zr_blocked, flush=True)
    # 6) Jooble (US): member queries first, then broad entry-level US titles
    jb = {}
    if "jooble" in SOURCES:
        jb = jooble_pull(([] if TOPUP else member_q), JOOBLE_TARGET)
        for jid, j in jb.items(): fresh[jid] = j
        print("jooble added:", len(jb), "| jooble calls", jooble_calls, "| errors", jooble_errors, flush=True)
    print("fresh pulled:", len(fresh), "| calls", calls, flush=True)
    # merge: keep current jobs that are re-listed or still recent; add fresh
    cutoff = (TODAY - datetime.timedelta(days=MAX_AGE)).isoformat()
    kept, removed = {}, 0
    for j in current:
        if j.get("expires"):
            if j["expires"] >= TODAY.isoformat(): kept[j["id"]] = j
            else: removed += 1
            continue
        if j["id"] in fresh or (j.get("posted") or "9999") >= cutoff: kept[j["id"]] = j
        else: removed += 1
    added = 0
    for jid, j in fresh.items():
        if jid not in kept: added += 1
        kept[jid] = j
    score = fit_scorer(inds, ctys, work, cvwords)
    before = len(kept)
    today_s = TODAY.isoformat()
    pins = [dict({k: v for k, v in j.items() if k != "pinned_for"}) for j in PINNED
            if (j.get("expires") or "9999") >= today_s and (j.get("posted") or today_s) >= (TODAY - datetime.timedelta(days=30)).isoformat()]
    pin_ids = {j["id"] for j in pins}
    kept = {k: j for k, j in kept.items() if k not in pin_ids and (eligible(j) or k in SENIOR_HITS)}
    print("entry level filter: kept", len(kept), "of", before, flush=True)
    pool = dedupe(list(kept.values()), score)
    dupes = len(kept) - len(pool)
    jobs = pins + select(pool, score)[:CAP - len(pins)]
    jobs.sort(key=lambda j: (j.get("posted") or ""), reverse=True)
    print("deduped:", dupes, "| pool:", len(pool), "| selected:", len(jobs), flush=True)
    meta = write_outputs(jobs, added, removed, member_q)
    reed_n = sum(1 for j in jobs if is_reed(j)); zr_n = sum(1 for j in jobs if is_zr(j)); jb_n = sum(1 for j in jobs if is_jooble(j))
    report = {"total": len(jobs), "reed_share": round(reed_n / max(1, len(jobs)), 2), "ziprecruiter_jobs": zr_n, "ziprecruiter_calls": zr_calls, "ziprecruiter_blocked": zr_blocked, "jooble_jobs": jb_n, "jooble_calls": jooble_calls, "duplicates_removed": dupes, "added": added, "removed_stale": removed, "adzuna_calls": calls, "filtered_out": before - len(kept), "remote": sum(1 for j in jobs if work_tier(j) == 2), "hybrid": sum(1 for j in jobs if work_tier(j) == 1), "onsite": sum(1 for j in jobs if work_tier(j) == 0), "reed_calls": reed_calls, "minutes": round((time.time() - t0) / 60, 1),
              "per_country": meta["per_country"], "member_queries": member_q, "top_member_industries": dict(inds.most_common(5)), "cv_signals": dict(cvwords.most_common(8)), "primary_countries": PRIMARY, "primary_share": round(sum(1 for j in jobs if j["country"] in PRIMARY) / max(1, len(jobs)), 3)}
    print("REPORT " + json.dumps(report), flush=True)
    open(os.path.join(ROOT, "scripts/last_refresh.json"), "w").write(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
