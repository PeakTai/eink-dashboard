import { Preferences } from "@capacitor/preferences";

export interface Settings {
  /**
   * 定位方式：
   * custom 用城市名做地理编码；manual 手动输入经纬度；device 用设备当前定位
   */
  locationMode: "custom" | "manual" | "device";
  /** 城市名，仅在 custom 模式下使用，用于 Open-Meteo 地理编码 */
  city: string;
  /** 城市纬度（地理编码结果缓存，城市变更后清空重新编码） */
  latitude: number | null;
  /** 城市经度（地理编码结果缓存） */
  longitude: number | null;
  /** 手动输入的纬度，仅在 manual 模式下使用 */
  manualLatitude: number | null;
  /** 手动输入的经度，仅在 manual 模式下使用 */
  manualLongitude: number | null;
  /** 页面整页刷新间隔（分钟） */
  refreshIntervalMin: number;
  /** 天气数据更新间隔（分钟） */
  weatherIntervalMin: number;
}

const SETTINGS_KEY = "settings";
const SETTINGS_VERSION = 4;
/** 旧版本默认城市，用于识别从未手动改过城市的旧设置 */
const LEGACY_DEFAULT_CITY = "北京";

export const DEFAULT_SETTINGS: Settings = {
  locationMode: "custom",
  city: "上海",
  latitude: null,
  longitude: null,
  manualLatitude: null,
  manualLongitude: null,
  refreshIntervalMin: 1,
  weatherIntervalMin: 60,
};

export async function getSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  if (!value) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const saved = JSON.parse(value) as Partial<Settings> & { version?: number };
    const settings: Settings = { ...DEFAULT_SETTINGS, ...saved };
    // 旧版默认城市是北京：未升级过的设置重置为新默认城市，经纬度一并清空重新编码
    if ((saved.version ?? 1) < SETTINGS_VERSION && settings.city === LEGACY_DEFAULT_CITY) {
      settings.city = DEFAULT_SETTINGS.city;
      settings.latitude = null;
      settings.longitude = null;
      await saveSettings(settings);
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await Preferences.set({
    key: SETTINGS_KEY,
    value: JSON.stringify({ ...settings, version: SETTINGS_VERSION }),
  });
}
