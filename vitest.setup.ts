/**
 * Yield one event-loop turn after every test. vitest 3 runs a file's
 * synchronous tests back to back without reading the main process's answers to
 * the task updates the worker sends, and a call unanswered for 60 s fails the
 * run; a checker file under coverage runs longer than that in total.
 */
import { afterEach } from "vitest";

// Taken before any test can install fake timers.
const { setImmediate } = globalThis;

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
