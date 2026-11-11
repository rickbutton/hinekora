import { type Theme, withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HowChain from "./HowChain.vue";
import HowLoop from "./HowLoop.vue";
import HowModel from "./HowModel.vue";
import HowParts from "./HowParts.vue";
import HowPresence from "./HowPresence.vue";
import HowTrace from "./HowTrace.vue";
import HowTree from "./HowTree.vue";
import HowWeights from "./HowWeights.vue";
import LandingCost from "./LandingCost.vue";
import LandingFinding from "./LandingFinding.vue";
import LandingItem from "./LandingItem.vue";
import PlaygroundFrame from "./PlaygroundFrame.vue";
import "@hinekora/item-card/style.css";
import "./style.css";
import "./landing.css";
import "./how.css";
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
        app.component("HowChain", HowChain);
        app.component("HowLoop", HowLoop);
        app.component("HowModel", HowModel);
        app.component("HowParts", HowParts);
        app.component("HowPresence", HowPresence);
        app.component("HowTrace", HowTrace);
        app.component("HowTree", HowTree);
        app.component("HowWeights", HowWeights);
        app.component("LandingCost", LandingCost);
        app.component("LandingFinding", LandingFinding);
        app.component("LandingItem", LandingItem);
        app.component("PlaygroundFrame", PlaygroundFrame);
    },
} satisfies Theme;
