import {
  Button,
  createDomModule,
  DivModule,
  Form,
  getRouter,
  Select,
  showToast,
  Spacer,
  TextInput,
} from "wok-ui";
import { getSettings, saveSettings } from "../../utils/settings";
import { clearWeatherCache, resolveDeviceLocation } from "../../utils/weather";
import "./style.less";

const LOCATION_OPTIONS = [
  { label: "自定义城市", value: "custom" },
  { label: "手动经纬度", value: "manual" },
  { label: "自动定位", value: "device" },
];

/** 坐标输入校验：必填，且在合法范围内 */
function validateCoordinate(val: string, max: number, name: string) {
  const text = val.trim();
  if (!text) {
    return { valid: false as const, msg: `请输入${name}` };
  }
  const num = Number(text);
  if (Number.isNaN(num)) {
    return { valid: false as const, msg: `${name}必须是数字` };
  }
  if (Math.abs(num) > max) {
    return { valid: false as const, msg: `${name}需在 -${max} ~ ${max} 之间` };
  }
  return { valid: true as const };
}

const REFRESH_OPTIONS = [
  { label: "1 分钟", value: "1" },
  { label: "5 分钟", value: "5" },
  { label: "15 分钟", value: "15" },
  { label: "30 分钟", value: "30" },
  { label: "1 小时", value: "60" },
];

const WEATHER_OPTIONS = [
  { label: "30 分钟", value: "30" },
  { label: "1 小时", value: "60" },
  { label: "2 小时", value: "120" },
  { label: "4 小时", value: "240" },
];

export class SettingsPage extends DivModule {
  constructor() {
    super("settings-page");
    void this.init();
  }

  private async init(): Promise<void> {
    const settings = await getSettings();
    const draft = { ...settings };

    // 城市输入块只在自定义城市模式下显示
    let cityBlockEl: HTMLElement | undefined;
    const cityBlock = createDomModule({
      postHandle: (el) => {
        cityBlockEl = el;
      },
      children: [
        { classNames: "settings-label", innerText: "城市" },
        new TextInput({
          value: draft.city,
          placeholder: "如：上海",
          onChange: (val) => {
            draft.city = val;
            // 城市变更后清空经纬度缓存，触发重新地理编码
            draft.latitude = null;
            draft.longitude = null;
          },
        }),
      ],
    });

    // 经纬度输入块只在手动模式下显示
    let manualBlockEl: HTMLElement | undefined;
    const manualBlock = createDomModule({
      postHandle: (el) => {
        manualBlockEl = el;
      },
      children: [
        { classNames: "settings-label", innerText: "纬度" },
        new TextInput({
          value: draft.manualLatitude === null ? "" : String(draft.manualLatitude),
          placeholder: "如：31.38",
          validator: (val) => validateCoordinate(val, 90, "纬度"),
          onChange: (val) => {
            draft.manualLatitude = val.trim() === "" ? null : Number(val);
          },
        }),
        { classNames: "settings-label", innerText: "经度" },
        new TextInput({
          value: draft.manualLongitude === null ? "" : String(draft.manualLongitude),
          placeholder: "如：121.25",
          validator: (val) => validateCoordinate(val, 180, "经度"),
          onChange: (val) => {
            draft.manualLongitude = val.trim() === "" ? null : Number(val);
          },
        }),
        { classNames: "settings-hint", innerText: "可在地图 App 里长按地点查看经纬度" },
      ],
    });

    const syncBlocks = () => {
      if (cityBlockEl) {
        cityBlockEl.style.display = draft.locationMode === "custom" ? "" : "none";
      }
      if (manualBlockEl) {
        manualBlockEl.style.display = draft.locationMode === "manual" ? "" : "none";
      }
    };
    syncBlocks();

    this.addChild(
      {
        classNames: "settings-header",
        children: [
          {
            tag: "i",
            classNames: "fas fa-arrow-left settings-back",
            attrs: { "aria-label": "返回" },
            onClick: () => window.history.back(),
          },
          { classNames: "settings-title", innerText: "设置" },
        ],
      },
      new Form({
        children: [
          { classNames: "settings-label", innerText: "位置来源" },
          new Select({
            value: draft.locationMode,
            options: LOCATION_OPTIONS,
            onChange: (val) => {
              draft.locationMode = val === "device" ? "device" : val === "manual" ? "manual" : "custom";
              syncBlocks();
            },
          }),
          cityBlock,
          manualBlock,
          { classNames: "settings-label", innerText: "页面刷新间隔" },
          new Select({
            value: String(draft.refreshIntervalMin),
            options: REFRESH_OPTIONS,
            onChange: (val) => {
              draft.refreshIntervalMin = Number(val);
            },
          }),
          { classNames: "settings-label", innerText: "天气更新间隔" },
          new Select({
            value: String(draft.weatherIntervalMin),
            options: WEATHER_OPTIONS,
            onChange: (val) => {
              draft.weatherIntervalMin = Number(val);
            },
          }),
          new Spacer("lg"),
          new Button({ text: "保存", type: "primary", formType: "submit", block: true }),
        ],
        onSubmit: async () => {
          if (draft.locationMode === "custom" && !draft.city.trim()) {
            showToast({ type: "warning", text: "请输入城市名" });
            return;
          }
          if (draft.locationMode === "manual") {
            if (draft.manualLatitude === null || draft.manualLongitude === null) {
              showToast({ type: "warning", text: "请输入纬度和经度" });
              return;
            }
          }
          if (draft.locationMode === "device") {
            const loc = await resolveDeviceLocation();
            if (!loc.ok) {
              showToast({ type: "warning", text: loc.reason });
              return;
            }
          }
          const locationChanged =
            draft.locationMode !== settings.locationMode ||
            draft.city !== settings.city ||
            draft.manualLatitude !== settings.manualLatitude ||
            draft.manualLongitude !== settings.manualLongitude;
          if (locationChanged) {
            await clearWeatherCache();
          }
          await saveSettings(draft);
          showToast({ type: "success", text: "已保存" });
          getRouter().push("/");
        },
      }),
    );
  }
}
