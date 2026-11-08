/**
 * Signature help: while the cursor sits in a call's argument list, the def's
 * parameters with the one being typed marked; while it follows a method's
 * words, the method's argument slots with the one being filled marked. Both
 * work on the tokens before the cursor alone, since the statement is usually
 * unfinished while this is wanted.
 */
import { type Method, type Slot } from "@hinekora/core";
import { type Token, tokenize } from "@hinekora/parser";
import type { SignatureHelp } from "vscode-languageserver-types";
import { localDefs } from "./completion.js";
import { atomOf, methodAt } from "./method-at.js";

/** The tokens before the cursor; an open string at the cursor is closed first. */
function tokensBefore(source: string, offset: number): Token[] | undefined {
    const prefix = source.slice(0, offset);
    try {
        return tokenize(prefix).filter((t) => t.kind !== "eof");
    } catch {
        try {
            return tokenize(`${prefix}"`).filter((t) => t.kind !== "eof");
        } catch {
            return undefined;
        }
    }
}

/** The call the cursor is inside, if any: its name and which argument is being typed. */
function enclosingCall(tokens: readonly Token[]): { name: string; argIndex: number } | undefined {
    let parens = 0;
    let braces = 0;
    let commas = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i]!;
        if (braces > 0) {
            // Inside a closed block argument: skip to its opening brace.
            if (t.kind === "rbrace") braces++;
            else if (t.kind === "lbrace") braces--;
            continue;
        }
        if (t.kind === "rparen") parens++;
        else if (t.kind === "lparen") {
            if (parens === 0) {
                const name = tokens[i - 1];
                return name?.kind === "ident" ? { name: name.text, argIndex: commas } : undefined;
            }
            parens--;
        } else if (t.kind === "comma" && parens === 0) commas++;
        else if (t.kind === "rbrace") braces++;
        else if (t.kind === "lbrace") return undefined; // the cursor is inside a block's steps
    }
    return undefined;
}

function callSignature(
    source: string,
    call: { name: string; argIndex: number },
): SignatureHelp | null {
    const def = localDefs(source).find((d) => d.name === call.name);
    if (def === undefined) return null;
    const params = def.params === "" ? [] : def.params.split(",").map((p) => p.trim());
    return {
        signatures: [
            {
                label: `${def.name}(${params.join(", ")})`,
                documentation:
                    def.proc === true
                        ? "local operation function"
                        : def.proc === false
                          ? "local predicate"
                          : "local def",
                parameters: params.map((p) => ({ label: p })),
            },
        ],
        activeSignature: 0,
        activeParameter: Math.min(call.argIndex, Math.max(params.length - 1, 0)),
    };
}

/** How a slot is written, for the signature's label. */
function slotLabel(slot: Slot): string {
    switch (slot.kind) {
        case "name":
            return slot.optional ? `["${slot.of}"]` : `"${slot.of}"`;
        case "names":
            return `"${slot.of}" …`;
        case "word":
            return slot.oneOf.join("|");
        case "int":
            return slot.optional ? "[count]" : "count";
        case "tier":
            return slot.optional ? "[t<n>]" : "t<n>";
    }
}

function methodSignature(method: Method, filled: number): SignatureHelp | null {
    if (method.args.length === 0) return null;
    const labels = method.args.map(slotLabel);
    const last = method.args[method.args.length - 1]!;
    // A repeated names slot stays active for every further name.
    const active = last.kind === "names" ? Math.min(filled, labels.length - 1) : filled;
    if (active >= labels.length) return null;
    return {
        signatures: [
            {
                label: `${method.words.join(" ")} ${labels.join(" ")}`,
                documentation: method.doc,
                parameters: labels.map((l) => ({ label: l })),
            },
        ],
        activeSignature: 0,
        activeParameter: active,
    };
}

export function getSignatureHelp(source: string, offset: number): SignatureHelp | null {
    const tokens = tokensBefore(source, offset);
    if (tokens === undefined || tokens.length === 0) return null;

    const call = enclosingCall(tokens);
    if (call !== undefined) {
        const sig = callSignature(source, call);
        if (sig !== null) return sig;
    }

    // A method's words followed by the arguments typed so far.
    const atoms = tokens.map(atomOf);
    const found = methodAt(atoms, tokens.length - 1);
    if (found === undefined) return null;
    const filled = tokens.length - (found.start + found.words);
    return methodSignature(found.method, filled);
}
