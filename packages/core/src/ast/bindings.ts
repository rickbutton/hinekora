/**
 * Name binding over the surface AST: every local def and every parameter, with
 * the span that declares it and every span that refers to it. This is what the
 * editor's highlight, go-to-definition, references and rename read, and what
 * hover uses to tell a parameter from a method word of the same name.
 *
 * Scoping is decided by the parser: a bare identifier becomes a `ParamRef` or a
 * `paramStep` only when it names a parameter of the enclosing def, so the walk
 * attributes each reference to the def whose body it sits in, including steps
 * written inside a call's block argument, which belong to the def they are
 * written in, not the one they are passed to.
 */
import type { Arg, Craft, Def, Pred, ProcDef, Stmt } from "./ast.js";
import type { SourceSpan } from "./span.js";

export type Binding =
    | {
          readonly kind: "def" | "proc";
          readonly name: string;
          readonly declaration: SourceSpan;
          readonly references: readonly SourceSpan[];
      }
    | {
          readonly kind: "param";
          readonly name: string;
          /** The def the parameter belongs to. */
          readonly owner: string;
          readonly declaration: SourceSpan;
          readonly references: readonly SourceSpan[];
      };

/** The span of the name that opens a call, `name(` … `)`. */
function callNameSpan(span: SourceSpan, name: string): SourceSpan {
    const { start } = span;
    return {
        start,
        end: {
            offset: start.offset + name.length,
            line: start.line,
            column: start.column + name.length,
        },
    };
}

class Collector {
    readonly calls = new Map<string, SourceSpan[]>();
    readonly params = new Map<string, SourceSpan[]>();

    private note(map: Map<string, SourceSpan[]>, name: string, span: SourceSpan): void {
        const spans = map.get(name);
        if (spans) spans.push(span);
        else map.set(name, [span]);
    }

    pred(p: Pred): void {
        switch (p.kind) {
            case "has":
                if (typeof p.mod === "object") this.note(this.params, p.mod.param, p.mod.span);
                if (typeof p.tier === "object") this.note(this.params, p.tier.param, p.tier.span);
                return;
            case "fractured":
                if (typeof p.mod === "object") this.note(this.params, p.mod.param, p.mod.span);
                return;
            case "compare":
                if (typeof p.value === "object")
                    this.note(this.params, p.value.param, p.value.span);
                return;
            case "not":
                this.pred(p.inner);
                return;
            case "and":
            case "or":
                this.pred(p.left);
                this.pred(p.right);
                return;
            case "call":
                this.note(this.calls, p.name, callNameSpan(p.span, p.name));
                this.args(p.args);
                return;
            case "isRarity":
            case "influenced":
            case "corrupted":
            case "eldritch":
            case "dominant":
                return;
        }
    }

    args(args: readonly Arg[]): void {
        for (const a of args) {
            if (a.kind === "param") this.note(this.params, a.param, a.span);
            else if (a.kind === "block") this.stmts(a.body);
        }
    }

    stmts(stmts: readonly Stmt[]): void {
        for (const s of stmts) {
            switch (s.kind) {
                case "operation":
                    for (const a of s.args) {
                        if (a.kind === "param") this.note(this.params, a.param, a.span);
                    }
                    break;
                case "paramStep":
                    this.note(this.params, s.param, s.span);
                    break;
                case "call":
                    this.note(this.calls, s.name, callNameSpan(s.span, s.name));
                    this.args(s.args);
                    break;
                case "until":
                    this.pred(s.pred);
                    this.stmts(s.body);
                    break;
                case "if":
                    this.pred(s.pred);
                    this.stmts(s.body);
                    if (s.elseBody !== undefined) this.stmts(s.elseBody);
                    break;
                case "restart":
                case "stop":
                    break;
            }
        }
    }
}

/** Every def, operation function and parameter of the craft, with its uses. */
export function bindingsOf(craft: Craft): Binding[] {
    const out: Binding[] = [];
    const calls = new Map<string, SourceSpan[]>();

    const collectBody = (d: Def | ProcDef): Collector => {
        const c = new Collector();
        if (d.kind === "def") c.pred(d.body);
        else c.stmts(d.body);
        for (const [name, spans] of c.calls) {
            const all = calls.get(name);
            if (all) all.push(...spans);
            else calls.set(name, [...spans]);
        }
        return c;
    };

    const top = new Collector();
    top.stmts(craft.body);
    for (const [name, spans] of top.calls) calls.set(name, [...spans]);

    const defs: (Def | ProcDef)[] = [...craft.defs, ...craft.procs];
    const collectors = defs.map((d) => [d, collectBody(d)] as const);

    for (const [d, c] of collectors) {
        out.push({
            kind: d.kind === "def" ? "def" : "proc",
            name: d.name,
            declaration: d.nameSpan,
            references: calls.get(d.name) ?? [],
        });
        d.params.forEach((p, i) => {
            out.push({
                kind: "param",
                name: p,
                owner: d.name,
                declaration: d.paramSpans[i]!,
                references: c.params.get(p) ?? [],
            });
        });
    }
    return out;
}

const covers = (span: SourceSpan, offset: number): boolean =>
    span.start.offset <= offset && offset < span.end.offset;

/** The binding whose declaration or one of whose references covers the offset. */
export function bindingAt(bindings: readonly Binding[], offset: number): Binding | undefined {
    return bindings.find(
        (b) => covers(b.declaration, offset) || b.references.some((r) => covers(r, offset)),
    );
}
