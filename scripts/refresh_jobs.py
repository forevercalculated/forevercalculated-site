#!/usr/bin/env python3
"""Forever Careers job refresh.
Keeps live roles, removes stale ones (not re-listed and older than MAX_AGE days), pulls fresh roles from Adzuna
across all 19 countries, and leans the pull toward what signed-up members want (industries, countries,
work style) and what their CVs show, plus entry-level roles people are likely to land.
Usage: ADMIN_KEY=... python3 scripts/refresh_jobs.py   (run from the repo root)
"""
import json, re, os, sys, time, datetime, collections, urllib.request, urllib.parse, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ID = os.environ.get("ADZUNA_APP_ID", "6a6b424b"); APP_KEY = os.environ.get("ADZUNA_APP_KEY", "cc549e49d03b3da032d317a06c182eed")
ADMIN_KEY = os.environ.get("ADMIN_KEY", ""); SITE = "https://forevercalculatedcareers.com"
REED_KEY = os.environ.get("REED_KEY", "ccef8776-5275-4435-8fad-bc41a22464c6")
SOURCES = os.environ.get("SOURCES", "adzuna,reed").split(",")
REED_BUDGET = int(os.environ.get("REED_BUDGET", "260"))
REED_SHARE = float(os.environ.get("REED_SHARE", "0.45")); MIN_PER_COUNTRY = int(os.environ.get("MIN_PER_COUNTRY", "150")); REED_ID_OFFSET = 10**12
MAX_AGE = int(os.environ.get("MAX_AGE_DAYS", "21")); CAP = int(os.environ.get("CAP", "12000"))
CALL_BUDGET = int(os.environ.get("CALL_BUDGET", "180")); SLEEP = 2.6
TODAY = datetime.date.today()
CC = {"UK":"gb","US":"us","CA":"ca","AU":"au","NZ":"nz","SG":"sg","ZA":"za","IN":"in","DE":"de","FR":"fr","NL":"nl","ES":"es","IT":"it","BE":"be","AT":"at","CH":"ch","PL":"pl","BR":"br","MX":"mx"}
TAG = {v:k for k,v in CC.items()}
BROAD_PAGES = {"gb":16,"us":16,"ca":5,"au":5,"nz":3,"in":3,"de":3,"fr":3,"sg":2,"za":2,"nl":2,"es":2,"it":2,"be":2,"at":2,"ch":2,"pl":2,"br":2,"mx":2}
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
    if what: q["what"] = what
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
        if want_remote and j.get("remote"): sc += 1
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
        rank = (1 if j["id"] >= REED_ID_OFFSET else 0, score(j), j.get("posted") or "")
        if key not in best or rank > best[key][0]: best[key] = (rank, j)
    return [v[1] for v in best.values()]

def select(jobs, score):
    """Balance sources and countries, then keep the best fits up to CAP."""
    jobs = sorted(jobs, key=score, reverse=True)
    reed_j = [j for j in jobs if j["id"] >= REED_ID_OFFSET]; adz_j = [j for j in jobs if j["id"] < REED_ID_OFFSET]
    reed_quota = min(len(reed_j), int(CAP * REED_SHARE)); adz_quota = CAP - reed_quota
    chosen, per_c = [], collections.Counter()
    # every country keeps a base selection of its best-fitting roles
    for j in adz_j:
        if j["country"] != "UK" and per_c[j["country"]] < MIN_PER_COUNTRY: chosen.append(j); per_c[j["country"]] += 1
    ids = {j["id"] for j in chosen}
    for j in adz_j:
        if len([x for x in chosen if x["id"] < REED_ID_OFFSET]) >= adz_quota: break
        if j["id"] not in ids: chosen.append(j); ids.add(j["id"])
    chosen += reed_j[:reed_quota]
    if len(chosen) < CAP:  # fill any gap with the next best of either source
        ids = {j["id"] for j in chosen}
        chosen += [j for j in jobs if j["id"] not in ids][:CAP - len(chosen)]
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
    target_cc = [CC[c] for c, _ in ctys.most_common(3)] or ["gb"]
    if "adzuna" not in SOURCES: member_q_adz = []
    else: member_q_adz = member_q
    for q in member_q_adz:
        for cc in target_cc:
            got = add(adzuna(cc, 1, q), cc); print("  member", cc, q, "+", got, flush=True)
    # 2) entry-level, easy-to-land roles in the UK and US
    for q in (ENTRY if "adzuna" in SOURCES else []):
        for cc in ("gb", "us"):
            add(adzuna(cc, 1, q), cc)
    print("after member + entry-level:", len(fresh), "| calls", calls, flush=True)
    # 3) broad newest roles in every country
    for cc, pages in (BROAD_PAGES.items() if "adzuna" in SOURCES else []):
        for p in range(1, pages + 1):
            res = adzuna(cc, p)
            if res is None: break
            add(res, cc)
            if len(res) < 50: break
    # 4) Reed (UK): member queries first, then entry-level and broad UK keywords
    if "reed" in SOURCES:
        reed_q = member_q + ENTRY + ["administrator", "customer service", "warehouse", "retail", "care", "sales", "driver", "cleaner",
                  "receptionist", "accounts", "teaching assistant", "chef", "security", "engineer", "project coordinator", "hr", "marketing", "it support"]
        reed_q = list(dict.fromkeys(reed_q))
        n0 = len(fresh)
        for q in reed_q:
            for skip in (0, 100):
                res = reed(q, skip)
                if res is None: break
                for r in res:
                    j = reed_job(r)
                    if j and j["id"] not in fresh: fresh[j["id"]] = j
                if len(res) < 100: break
            if reed_calls >= REED_BUDGET: break
        # city sweep: members' own cities first, then major UK cities, for the top member queries
        cities = [c for c, _ in MEMBER_CITIES.most_common(5)] + UK_CITIES
        cities = list(dict.fromkeys(cities))
        sweep_q = list(dict.fromkeys(member_q[:6] + ["assistant", "administrator", "warehouse", "retail"]))
        for city in cities:
            for q in sweep_q:
                res = reed(q, 0, city)
                if res is None: break
                for r in res:
                    j = reed_job(r)
                    if j and j["id"] not in fresh: fresh[j["id"]] = j
            if reed_calls >= REED_BUDGET: break
        print("reed added:", len(fresh) - n0, "| reed calls", reed_calls, "| member cities:", dict(MEMBER_CITIES.most_common(5)), flush=True)
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
    pool = dedupe(list(kept.values()), score)
    dupes = len(kept) - len(pool)
    jobs = select(pool, score)
    jobs.sort(key=lambda j: (j.get("posted") or ""), reverse=True)
    print("deduped:", dupes, "| pool:", len(pool), "| selected:", len(jobs), flush=True)
    # write outputs
    data = [dict({k: j[k] for k in ("id","title","company","location","salary_min","salary_max","category","url","country")}, **({"expires": j["expires"]} if j.get("expires") else {})) for j in jobs]
    open(os.path.join(ROOT, "netlify/lib/jobs-data.mjs"), "w", encoding="utf-8").write("export default " + json.dumps(data, ensure_ascii=False) + ";\n")
    meta = {"refreshed": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "source": "Adzuna + Reed" if "reed" in SOURCES else "Adzuna",
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
    h = re.sub(r"const FC_JOBS_UPDATED = '[0-9-]*';", "const FC_JOBS_UPDATED = '%s';" % TODAY.isoformat(), h)
    open(p, "w", encoding="utf-8").write(h)
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(h)
    reed_n = sum(1 for j in jobs if j["id"] >= REED_ID_OFFSET)
    report = {"total": len(jobs), "reed_share": round(reed_n / max(1, len(jobs)), 2), "duplicates_removed": dupes, "added": added, "removed_stale": removed, "adzuna_calls": calls, "reed_calls": reed_calls, "minutes": round((time.time() - t0) / 60, 1),
              "per_country": meta["per_country"], "member_queries": member_q, "top_member_industries": dict(inds.most_common(5)), "cv_signals": dict(cvwords.most_common(8))}
    print("REPORT " + json.dumps(report), flush=True)
    open(os.path.join(ROOT, "scripts/last_refresh.json"), "w").write(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
