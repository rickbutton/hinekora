# Decode poe.ninja build-search protobuf facets and NDIC dictionaries into ranked tables.
import sys, struct, json, os
S = os.environ.get("NINJA_SCRATCH") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ns = {}; exec(open(S + "/tools/pbraw.py").read().split("b = open(")[0], ns); parse = ns["parse"]

def ndic(path):
    b = open(path, "rb").read()
    assert b[:4] == b"NDIC", path
    count = struct.unpack_from("<I", b, 12)[0]
    entries = struct.unpack_from("<I", b, 0x1c)[0]
    lens_at = 0x24 + entries * 8
    for w, fmt in ((1, "B"), (2, "<H"), (4, "<I")):
        start = lens_at + count * w
        lens = [struct.unpack_from(fmt, b, lens_at + i * w)[0] for i in range(count)]
        if start + sum(lens) == len(b):
            out = []; p = start
            for n in lens: out.append(b[p:p+n].decode("utf-8")); p += n
            return out
    raise ValueError("cannot lay out %s: count=%d entries=%d size=%d" % (path, count, entries, len(b)))

def search(path):
    root = parse(open(path, "rb").read())[0][2]
    total = [v for f, t, v in root if f == 1 and t == "v"][0]
    facets = {}; dicts = {}
    for f, t, v in root:
        if f == 2 and t == "m":
            name = [x for x in v if x[0] == 1][0][2]
            rows = {}
            for x in v:
                if x[0] == 3:
                    d = dict((a, c) for a, b_, c in x[2] if b_ == "v")
                    rows[d.get(1, 0)] = d.get(2, 0)
            facets[name] = rows
        if f == 6 and t == "m":
            name = [x for x in v if x[0] == 1][0][2]
            dicts[name] = [x[2] for x in v if x[0] in (2, 3)]
    return total, facets, dicts

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "dicts":
        total, facets, dicts = search(sys.argv[2])
        print(json.dumps(dicts, indent=1))
    elif cmd == "table":
        # table <search.bin> <facet> <dict.bin> [top]
        total, facets, dicts = search(sys.argv[2])
        names = ndic(sys.argv[4]); rows = facets[sys.argv[3]]
        top = int(sys.argv[5]) if len(sys.argv) > 5 else 50
        print("total characters", total, "| facet", sys.argv[3], "rows", len(rows), "| dict entries", len(names))
        for i, (k, c) in enumerate(sorted(rows.items(), key=lambda kv: -kv[1])[:top]):
            nm = names[k] if k < len(names) else "?%d" % k
            print("%5.1f%%  %6d  %s" % (100.0 * c / total, c, nm))
