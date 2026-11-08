import { defineConfig } from "vite";

export default defineConfig({
    // Relative asset paths, so the built page works from any directory or a
    // static host's subpath.
    base: "./",
    build: {
        // Monaco's editor chunk is large by nature; the warning adds nothing.
        chunkSizeWarningLimit: 4000,
    },
});
