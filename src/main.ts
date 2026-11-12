import "wok-ui/dist/style.css";
import "./css/global.less";
import { initRouter, setColor, showToast } from "wok-ui";
import { App } from "@capacitor/app";
import { DashboardPage } from "./pages/dashboard";
import { SettingsPage } from "./pages/settings";

// 墨水屏只显示黑白，主题色全部覆盖为黑白色阶
setColor({
  primary: "#000000",
  success: "#000000",
  danger: "#000000",
  warning: "#000000",
  border: "#000000",
  text: "#000000",
  textSecondary: "#333333",
  outline: "#000000",
});

initRouter({
  mode: "hash",
  rules: [
    { path: "/", module: () => new DashboardPage() },
    { path: "/settings", module: () => new SettingsPage() },
    { path: "*", module: () => new DashboardPage() },
  ],
}).mount(document.body);

const BACK_EXIT_TIMEOUT = 2000;
let backExitTimer: number | undefined;

App.addListener("backButton", () => {
  const hash = window.location.hash;
  const isHome = !hash || hash === "#" || hash === "#/";

  if (!isHome) {
    window.history.back();
    return;
  }

  if (backExitTimer) {
    App.exitApp();
    return;
  }

  showToast({
    type: "warning",
    text: "再按一次退出",
    duration: BACK_EXIT_TIMEOUT,
  });
  backExitTimer = window.setTimeout(() => {
    backExitTimer = undefined;
  }, BACK_EXIT_TIMEOUT);
});
