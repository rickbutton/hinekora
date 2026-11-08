/**
 * Inlay hints: at a def's declaration, what each parameter stands for as its
 * uses determine it (`m: mod`, `step: steps`); at a call, the parameter each
 * argument fills (`roll(m: "maximum life", step: chaos)`). A forwarded
 * parameter of the same name gets no hint, it would only repeat itself.
 */
import {
    type Arg,
    type Craft,
    type Def,
    PARAM_SORT_WORD,
    paramSorts,
    type Pred,
    type ProcDef,
    type SourceSpan,
    type Stmt,
} from "@hinekora/core";
import { parseCached } from "./analysis.js";
import { type InlayHint, InlayHintKind, type Position } from "vscode-languageserver-types";

function positionAfter(span: SourceSpan): Position {
    return { line: span.end.line - 1, character: span.end.column - 1 };
}
function positionAt(span: SourceSpan): Position {
    return { line: span.start.line - 1, character: span.start.column - 1 };
}

class Hints {
    readonly out: InlayHint[] = [];
    private readonly defs: ReadonlyMap<string, Def | ProcDef>;

    constructor(craft: Craft) {
        this.defs = new Map([...craft.defs, ...craft.procs].map((d) => [d.name, d]));
    }

    declaration(d: Def | ProcDef): void {
        const sorts = paramSorts(d);
        d.params.forEach((p, i) => {
            const sort = sorts.get(p);
            if (sort === undefined) return;
            this.out.push({
                position: positionAfter(d.paramSpans[i]!),
                label: `: ${PARAM_SORT_WORD[sort]}`,
                kind: InlayHintKind.Type,
            });
        });
    }

    call(name: string, args: readonly Arg[]): void {
        const def = this.defs.get(name);
        args.forEach((a, i) => {
            const p = def?.params[i];
            if (p !== undefined && !(a.kind === "param" && a.param === p)) {
                this.out.push({
                    position: positionAt(a.span),
                    label: `${p}:`,
                    kind: InlayHintKind.Parameter,
                    paddingRight: true,
                });
            }
            if (a.kind === "block") this.stmts(a.body);
        });
    }

    pred(p: Pred): void {
        switch (p.kind) {
            case "call":
                this.call(p.name, p.args);
                return;
            case "not":
                this.pred(p.inner);
                return;
            case "and":
            case "or":
                this.pred(p.left);
                this.pred(p.right);
                return;
            default:
                return;
        }
    }

    stmts(stmts: readonly Stmt[]): void {
        for (const s of stmts) {
            switch (s.kind) {
                case "call":
                    this.call(s.name, s.args);
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
                default:
                    break;
            }
        }
    }
}

export function getInlayHints(source: string): InlayHint[] {
    const parsed = parseCached(source);
    if (!parsed.ok) return [];
    const h = new Hints(parsed.craft);
    for (const d of parsed.craft.defs) {
        h.declaration(d);
        h.pred(d.body);
    }
    for (const d of parsed.craft.procs) {
        h.declaration(d);
        h.stmts(d.body);
    }
    h.stmts(parsed.craft.body);
    return h.out.sort(
        (a, b) => a.position.line - b.position.line || a.position.character - b.position.character,
    );
}
