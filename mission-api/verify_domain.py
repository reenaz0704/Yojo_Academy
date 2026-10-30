"""Admin tool: compare the configured Mission 5 answer with the live RDAP record.
  python verify_domain.py            show registry/registrar expiry and whether it matches the configured date
  python verify_domain.py --apply    store the registry expiry date as the answer (writes the DB override)
Needs outbound internet; the Academy itself never calls RDAP, so students are not affected if it is down."""
import json, subprocess, sys
import domaindate

SOURCES = [("Verisign registry", f"https://rdap.verisign.com/com/v1/domain/{domaindate.DOMAIN}"), ("GoDaddy registrar", f"https://rdap.godaddy.com/v1/domain/{domaindate.DOMAIN.upper()}")]


def fetch(url):
    # curl uses the system certificate store (some Python builds ship without root certificates)
    out = subprocess.run(["curl", "-fsS", "-m", "15", url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main():
    found = {}
    for name, url in SOURCES:
        try:
            ev = {e["eventAction"]: e["eventDate"] for e in fetch(url).get("events", [])}
            found[name] = ev.get("expiration") or ev.get("registrar expiration")
        except Exception as e:  # lookup services can be down: report, never guess
            found[name] = None
            print(f"{name}: lookup failed ({type(e).__name__})")
    dates = {domaindate.parse(v) for v in found.values() if v}
    for k, v in found.items():
        print(f"{k}: {v}")
    cfg = domaindate.expected()
    print(f"configured ({domaindate.source()}): {cfg}")
    if not dates:
        sys.exit("No source could be read. Nothing changed.")
    if len(dates) > 1:
        sys.exit(f"Sources disagree: {sorted(map(str, dates))}. Nothing changed.")
    live = dates.pop()
    print("MATCH" if live == cfg else f"MISMATCH: live record says {live}")
    if "--apply" in sys.argv and live != cfg:
        domaindate.set_expected(live.isoformat())
        print("Stored", live)


if __name__ == "__main__":
    main()
