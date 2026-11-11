# Definitions

`def` gives a name to a condition or to a sequence of steps. The body decides which.

| Form                                | Declares            | Used                                   |
| ----------------------------------- | ------------------- | -------------------------------------- |
| `def name(params) = <condition>`    | a condition         | where a [condition](./conditions) goes |
| `def name(params) { <statements> }` | a sequence of steps | as a statement, `name(args)`           |

A definition sits at the top level of the file, before or after its uses. No other file
sees it. A call always has parentheses, even with no arguments.

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: rare
}

def eleRes(t) = has "fire res" t or has "cold res" t or has "lightning res" t

def roll(want, step) {
    until has want and eleRes(t2) {
        step
    }
}

roll("maximum life", { scour alchemy })
```

## Inlining

The checker replaces each call with the definition's body, with the arguments in place of
the parameters. It checks that body against the item at the call. A definition has no state
and no result of its own, and the checker does not check a definition that no one calls.

The checker reports an error in a body at the step that caused it. For a step passed as an
argument, that is the argument at the call.

## Parameters

A parameter has no declared type. The checker infers its kind from how the body uses it.

| Kind  | Used as                                              | Argument                       |
| ----- | ---------------------------------------------------- | ------------------------------ |
| tier  | the tier after a name                                | `t1`                           |
| count | the number after a count comparison                  | `2`                            |
| mod   | a quoted name: a modifier, an essence, a Harvest tag | `"maximum life"`               |
| steps | a statement of its own                               | a statement or a `{ … }` block |

The kinds are distinct. `t1` is a tier and `1` is a count, and neither stands for the other.
The value in `has "maximum life" >= 110` must be a literal number.

A steps argument runs where the body writes the parameter, as if pasted there. A
[`restart`](./until) inside it returns to the `until` that encloses that point in the body. A
single statement needs no braces: `roll("maximum life", chaos)`.

A parameter hides an operation of the same name inside the body. In
`def roll(chaos) { chaos }` the statement `chaos` is the parameter.

## What the checker rejects

| Cause                               | Message                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| a parameter used as two kinds       | `parameter "x" of "f" is used in conflicting ways (as a tier and as a count)` |
| a parameter the body does not use   | `parameter "y" of "f" is never used`                                          |
| an argument of the wrong kind       | `argument 1 of "f" should be a tier (t1)`                                     |
| the wrong number of arguments       | `"g" expects 1 argument, got 0`                                               |
| a call to a name with no definition | `unknown def "h"`                                                             |
| two definitions with one name       | `duplicate def "g"`                                                           |
| a definition that calls itself      | `recursive def "g" is not allowed`                                            |
| a condition called as a statement   | `"f" is a condition, use it inside 'if' or 'until', not as a step`            |
| steps called in a condition         | `"g" runs operations, use it as a step, not inside a condition`               |

The editor shows each parameter's inferred kind beside its declaration. See
[Editor support](../editor).
