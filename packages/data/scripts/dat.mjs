/**
 * The game's compiled tables (`.datc64`), as ggpk.exposed serves them: a row
 * count, fixed-width rows, then a data section opened by eight 0xBB bytes. A
 * string column holds an offset into that section, where the string is
 * UTF-16 up to a two-byte zero. Column offsets come from the poe-tool-dev
 * dat-schema for each table.
 */
import { readFileSync } from "node:fs";

/** The table's bytes: the local copy `fileEnv` names, else fetched from `url`. */
export async function datTable(url, fileEnv) {
    if (process.env[fileEnv]) return readFileSync(process.env[fileEnv]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

/** Every row as an object of its string columns, `columns` naming each
 *  column's byte offset within a row. */
export function readStringColumns(buf, columns) {
    const count = buf.readUInt32LE(0);
    const data = buf.indexOf(Buffer.alloc(8, 0xbb), 4);
    if (data < 0) throw new Error("no data section in the table");
    const width = (data - 4) / count;
    const text = (offset) => {
        const start = data + offset;
        let end = start;
        while (end + 1 < buf.length && !(buf[end] === 0 && buf[end + 1] === 0)) end += 2;
        return buf.toString("utf16le", start, end);
    };
    return Array.from({ length: count }, (_unused, row) =>
        Object.fromEntries(
            Object.entries(columns).map(([name, at]) => [
                name,
                text(Number(buf.readBigUInt64LE(4 + row * width + at))),
            ]),
        ),
    );
}
