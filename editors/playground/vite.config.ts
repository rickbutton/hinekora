import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
    // Relative asset paths, so the built page works from any directory or a
    // static host's subpath.
    base: "./",
    server: {
        // The example guides and the data JSON live outside this package.
        fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    },
    build: {
        // Monaco's editor chunk is large by nature; the warning adds nothing.
        chunkSizeWarningLimit: 4000,
    },
});
