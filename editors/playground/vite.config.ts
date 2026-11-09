import { defineConfig } from "vite";

export default defineConfig({
    // Relative asset paths, so the built page works from any directory or a
    // static host's subpath.
    base: "./",
    build: {
        // Monaco and Mermaid each get a chunk of their own, so the page's own
        // code is the only one that changes between deploys and the browser
        // keeps the big ones cached. The libraries are large by nature; the
        // size warning adds nothing.
        chunkSizeWarningLimit: 5000,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined;
                    if (id.includes("monaco-editor")) return "monaco";
                    return "vendor";
                },
            },
        },
    },
});
