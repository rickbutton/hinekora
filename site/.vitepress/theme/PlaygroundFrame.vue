<script setup lang="ts">
import { withBase } from "vitepress";

// The playground is its own Vite app, built unchanged and copied under
// public/playground/app. The site's header names the project, so the app's
// own title is hidden; the frame is same-origin, so its document is ours.
function adopt(event: Event): void {
    const doc = (event.target as HTMLIFrameElement).contentDocument;
    if (doc === null) return;
    const style = doc.createElement("style");
    style.textContent = "body > header > h1 { display: none; }";
    doc.head.append(style);
}
</script>

<template>
    <div class="playground-frame">
        <iframe
            :src="withBase('/playground/app/index.html')"
            title="hinekora playground"
            @load="adopt"
        ></iframe>
    </div>
</template>

<style scoped>
.playground-frame {
    height: calc(100vh - var(--vp-nav-height));
    height: calc(100dvh - var(--vp-nav-height));
    border-top: 1px solid var(--vp-c-divider);
}

iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #1e1e1e;
}
</style>
