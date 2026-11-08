# For the top skills of a league, fetch poe.ninja's filtered search payload and list the top
# characters (account, name) so the builds can be loaded into Path of Building.
import sys, json, os, time, urllib.request, urllib.parse
S = os.environ["NINJA_SCRATCH"]
ns = {"__file__": S + "/tools/ninja.py"}; exec(open(S + "/tools/ninja.py").read().split("if __name__")[0], ns)
league, version, skills_dict, top_skills, per_skill = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) hinekora-research (rick@button.dev)"
total, facets, _ = ns["search"](S + f"/ninja/{league}-search.bin")
names = ns["ndic"](S + "/ninja/dict-" + skills_dict + ".bin")
ranked = sorted(((names[k], c) for k, c in facets["skills"].items() if k < len(names)), key=lambda r: -r[1])[:top_skills]
out = {"league": league, "snapshot": version, "characters": total, "skills": []}
def column(root, label):
    for f, t, v in root:
        if f == 12 and t == "m" and v and v[0][2] == label:
            return [c for a, b, c in v if a == 7 and b == "s"]
    return []
for skill, count in ranked:
    url = f"https://poe.ninja/poe1/api/builds/{version}/search?overview={league}&type=exp&skills={urllib.parse.quote(skill)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    data = urllib.request.urlopen(req, timeout=60).read()
    root = ns["parse"](data)[0][2]
    ftotal = [v for f, t, v in root if f == 1 and t == "v"][0]
    chars = list(zip(column(root, "account"), column(root, "name")))[:per_skill]
    out["skills"].append({"skill": skill, "count": count, "pct": round(100 * count / total, 2), "filtered_total": ftotal,
        "characters": [{"account": a, "name": n, "url": f"https://poe.ninja/poe1/builds/{league}/character/{urllib.parse.quote(a)}/{urllib.parse.quote(n)}"} for a, n in chars]})
    print(f"{skill:40s} {count:6d} filtered={ftotal} chars={len(chars)}")
    time.sleep(1.5)
json.dump(out, open(f"docs/research/data/ninja-top-characters-{league}.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
