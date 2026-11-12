/**
 * Each editor feature on its own: a fault of the tool's own in one (a case
 * the checker or the renderer does not handle) degrades that feature alone,
 * which then answers as if it had nothing to say, and is reported once.
 */

/** Where a fault is reported: the server's log, or the console. */
let reporter: (feature: string, error: unknown) => void = (feature, error) => {
    console.error(`hinekora: ${feature} failed: ${messageOf(error)}`);
};
const reported = new Set<string>();

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Send the faults to `report` (the language server's log). */
export function setFaultReporter(report: (feature: string, error: unknown) => void): void {
    reporter = report;
}

/** `fn`, answering `fallback` where it throws; each fault is reported once. */
export function guarded<A extends readonly unknown[], R>(
    feature: string,
    fn: (...args: A) => R,
    fallback: (error: unknown, ...args: A) => R,
): (...args: A) => R {
    return (...args) => {
        try {
            return fn(...args);
        } catch (error) {
            const key = `${feature}:${messageOf(error)}`;
            if (!reported.has(key)) {
                reported.add(key);
                reporter(feature, error);
            }
            return fallback(error, ...args);
        }
    };
}
