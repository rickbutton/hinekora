# Schema-less protobuf dump: prints field numbers, wire types and values; nested messages are
# decoded when their bytes parse cleanly as a message.
import sys
def varint(b, i):
    r = 0; s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if not c & 0x80: return r, i
def parse(b, depth=0, limit=None):
    i = 0; out = []
    while i < len(b):
        tag, i = varint(b, i); f, wt = tag >> 3, tag & 7
        if wt == 0: v, i = varint(b, i); out.append((f, 'v', v))
        elif wt == 1: v = b[i:i+8]; i += 8; out.append((f, '64', v.hex()))
        elif wt == 5: v = b[i:i+4]; i += 4; out.append((f, '32', v.hex()))
        elif wt == 2:
            n, i = varint(b, i); v = b[i:i+n]; i += n
            sub = None
            if n and depth < 6:
                try: sub = parse(v, depth+1)
                except Exception: sub = None
            try:
                s = v.decode('utf-8')
                printable = all(32 <= ord(c) < 0x10000 and c not in '\x7f' for c in s)
            except Exception: s = None; printable = False
            if sub is not None and (not printable or n > 40): out.append((f, 'm', sub))
            elif printable: out.append((f, 's', s))
            else: out.append((f, 'b', v.hex()[:40]))
        else: raise ValueError('bad wire type %d at %d' % (wt, i))
    return out
def dump(items, ind=0, maxitems=60, lines=[0], maxlines=400):
    for k, (f, t, v) in enumerate(items):
        if lines[0] > maxlines: return
        if k >= maxitems: print(' '*ind + '... %d more' % (len(items)-k)); lines[0]+=1; return
        if t == 'm': print(' '*ind + '%d: msg[%d]' % (f, len(v))); lines[0]+=1; dump(v, ind+2, maxitems, lines, maxlines)
        else: print(' '*ind + '%d: %s %r' % (f, t, v if not isinstance(v, str) else v[:80])); lines[0]+=1
b = open(sys.argv[1], 'rb').read()
dump(parse(b), 0, int(sys.argv[2]) if len(sys.argv) > 2 else 60)
