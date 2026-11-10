import { type Theme, withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./style.css";

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
    },
} satisfies Theme;
