import { type Theme, withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";
import LandingCost from "./LandingCost.vue";
import LandingFinding from "./LandingFinding.vue";
import PlaygroundFrame from "./PlaygroundFrame.vue";
import "@hinekora/item-card/style.css";
import "./style.css";
import "./landing.css";
import "./reference.css";
import "./playground.css";

declare module "vue" {
    interface ComponentCustomProperties {
        /** A site path under the deploy base, for raw HTML in a page. */
        $withBase: typeof withBase;
    }
}

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.config.globalProperties.$withBase = withBase;
        app.component("LandingCost", LandingCost);
        app.component("LandingFinding", LandingFinding);
        app.component("PlaygroundFrame", PlaygroundFrame);
    },
} satisfies Theme;
