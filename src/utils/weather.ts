import { Preferences } from "@capacitor/preferences";
import { Geolocation } from "@capacitor/geolocation";
import { Settings, saveSettings } from "./settings";

export interface CurrentWeather {
  /** 天气现象，如"多云" */
  label: string;
  /** Font Awesome 图标类名（不含 fas 前缀） */
  icon: string;
  /** WMO 天气码，用于生活建议判断 */
  code: number;
  temperature: number;
  /** 体感温度 */
  apparentTemperature: number;
  tempMax: number;
  tempMin: number;
  /** 风向，如"东南风" */
  windDirection: string;
  /** 风力等级（蒲福风级） */
  windScale: number;
  /** 气压 hPa */
  pressure: number;
  /** 相对湿度 % */
  humidity: number;
}

export interface AirQuality {
  /** 美国标准 AQI 数值 */
  aqi: number;
  /** 等级，如"优"、"轻度污染" */
  level: string;
  /** PM2.5 浓度 μg/m³ */
  pm25: number;
}

export interface DailyForecast {
  /** 星期几，如"周四" */
  weekday: string;
  label: string;
  icon: string;
  tempMax: number;
  tempMin: number;
}

export interface HourlyRain {
  /** 小时标签，如"14时" */
  hour: string;
  /** 该小时降水量 mm */
  precipitation: number;
}

export interface WeatherData {
  /** 缓存结构版本，升级时丢弃旧缓存 */
  version: number;
  /** 定位标识：city:城市名 或 geo:经纬度，定位变化后旧缓存作废 */
  locationKey: string;
  current: CurrentWeather;
  /** 未来三天预报 */
  daily: DailyForecast[];
  /** 未来 6 小时逐小时降雨 */
  hourlyRain: HourlyRain[];
  /** 空气质量，接口失败时为 null */
  airQuality: AirQuality | null;
  /** 今日紫外线指数最大值 */
  uvIndexMax: number | null;
  /** 数据获取时间戳（毫秒） */
  fetchedAt: number;
}

const CACHE_KEY = "weather-cache";
const CACHE_VERSION = 6;
/** 逐小时降雨展示的小时数 */
const RAIN_HOURS = 6;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Open-Meteo WMO 天气码 → 中文描述与黑白图标 */
function mapWeatherCode(code: number): { label: string; icon: string } {
  if (code === 0) return { label: "晴", icon: "fa-sun" };
  if (code === 1) return { label: "晴间多云", icon: "fa-cloud-sun" };
  if (code === 2) return { label: "多云", icon: "fa-cloud-sun" };
  if (code === 3) return { label: "阴", icon: "fa-cloud" };
  if (code === 45 || code === 48) return { label: "雾", icon: "fa-smog" };
  if (code >= 51 && code <= 57) return { label: "毛毛雨", icon: "fa-cloud-rain" };
  if (code === 61 || code === 80) return { label: "小雨", icon: "fa-cloud-rain" };
  if (code === 63 || code === 81) return { label: "中雨", icon: "fa-cloud-showers-heavy" };
  if (code === 65 || code === 82) return { label: "大雨", icon: "fa-cloud-showers-heavy" };
  if (code === 66 || code === 67) return { label: "冻雨", icon: "fa-cloud-rain" };
  if (code === 71 || code === 85) return { label: "小雪", icon: "fa-snowflake" };
  if (code === 73) return { label: "中雪", icon: "fa-snowflake" };
  if (code === 75 || code === 77 || code === 86) return { label: "大雪", icon: "fa-snowflake" };
  if (code >= 95) return { label: "雷阵雨", icon: "fa-bolt" };
  return { label: "未知", icon: "fa-question" };
}

const WIND_DIRECTIONS = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];

/** 风向角度 → 八方位中文 */
function mapWindDirection(deg: number): string {
  return WIND_DIRECTIONS[Math.round(deg / 45) % 8];
}

/** 风速 km/h → 蒲福风级 */
function mapWindScale(kmh: number): number {
  const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  return thresholds.filter((t) => kmh >= t).length;
}

const AQI_LEVELS: Array<{ max: number; level: string }> = [
  { max: 50, level: "优" },
  { max: 100, level: "良" },
  { max: 150, level: "轻度污染" },
  { max: 200, level: "中度污染" },
  { max: 300, level: "重度污染" },
  { max: Number.POSITIVE_INFINITY, level: "严重污染" },
];

function mapAqiLevel(aqi: number): string {
  return AQI_LEVELS.find((item) => aqi <= item.max)?.level ?? "未知";
}

/** 拉取空气质量，失败返回 null（不影响天气主体展示） */
async function fetchAirQuality(latitude: number, longitude: number): Promise<AirQuality | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "us_aqi,pm2_5",
      timezone: "auto",
    });
    const resp = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    if (!resp.ok) {
      return null;
    }
    const json = await resp.json();
    const aqi = Math.round(json.current.us_aqi);
    if (Number.isNaN(aqi)) {
      return null;
    }
    return {
      aqi,
      level: mapAqiLevel(aqi),
      pm25: Math.round(json.current.pm2_5),
    };
  } catch {
    return null;
  }
}

/** 定位结果：失败时带上可直接展示给用户的原因 */
export type DeviceLocationResult =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; reason: string };

/** Capacitor Geolocation 原生错误码 → 中文提示 */
const GEOLOCATION_ERROR_HINTS: Record<string, string> = {
  "OS-PLUG-GLOC-0002": "设备没有可用的定位来源",
  "OS-PLUG-GLOC-0003": "定位权限被拒绝",
  "OS-PLUG-GLOC-0007": "系统定位服务未开启",
  "OS-PLUG-GLOC-0009": "系统拒绝开启定位",
  "OS-PLUG-GLOC-0010": "定位超时，未能获取到坐标",
  "OS-PLUG-GLOC-0015": "Google 定位服务不可用",
  "OS-PLUG-GLOC-0017": "系统定位和网络定位均已关闭",
  "OS-PLUG-GLOC-0018": "Manifest 缺少定位权限声明",
};

/**
 * 请求定位并返回当前坐标。
 * 墨水屏设备多靠 WiFi/基站定位，用低精度即可，顺便省电；
 * 无 GPS 且无 Google 服务的设备可能无法定位，此时返回失败原因。
 */
export async function resolveDeviceLocation(): Promise<DeviceLocationResult> {
  try {
    // 先查状态：系统定位开关关闭时 checkPermissions 会直接抛错
    let perm = await Geolocation.checkPermissions();
    if (perm.coarseLocation !== "granted" && perm.location !== "granted") {
      perm = await Geolocation.requestPermissions();
      if (perm.coarseLocation !== "granted" && perm.location !== "granted") {
        return { ok: false, reason: "定位权限未授予" };
      }
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 10 * 60 * 1000,
    });
    return { ok: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = (err as Error)?.message ?? String(err);
    console.warn("[weather] 获取定位失败", code, message);
    return {
      ok: false,
      reason: (code && GEOLOCATION_ERROR_HINTS[code]) ?? `定位失败：${message}`,
    };
  }
}

/** 缓存里的定位标识是否与当前设置匹配 */
function matchesLocation(data: WeatherData, settings: Settings): boolean {
  switch (settings.locationMode) {
    case "device":
      // 自动定位模式下经纬度会随设备移动变化，只校验来源类型
      return data.locationKey.startsWith("geo:");
    case "manual":
      return data.locationKey === manualLocationKey(settings.manualLatitude, settings.manualLongitude);
    default:
      return data.locationKey === `city:${settings.city}`;
  }
}

/** 手动经纬度的缓存标识 */
function manualLocationKey(lat: number | null, lon: number | null): string {
  return `manual:${lat ?? ""},${lon ?? ""}`;
}

export async function getCachedWeather(settings: Settings): Promise<WeatherData | null> {
  const { value } = await Preferences.get({ key: CACHE_KEY });
  if (!value) {
    return null;
  }
  try {
    const data = JSON.parse(value) as WeatherData;
    // 结构升级或定位变更后丢弃旧缓存，避免显示旧位置数据
    return data.version === CACHE_VERSION && matchesLocation(data, settings) ? data : null;
  } catch {
    return null;
  }
}

export function isWeatherStale(data: WeatherData | null, intervalMin: number): boolean {
  return !data || Date.now() - data.fetchedAt >= intervalMin * 60 * 1000;
}

/** 清除天气缓存（城市变更后调用，避免继续显示旧城市数据） */
export async function clearWeatherCache(): Promise<void> {
  await Preferences.remove({ key: CACHE_KEY });
}

const RAIN_SNOW_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

/** 根据当前天气、空气质量与紫外线推导生活建议（穿衣 / 防晒 / 户外） */
export function buildLifeTips(weather: WeatherData): string[] {
  const { current, airQuality, uvIndexMax } = weather;
  const tips: string[] = [];

  const feels = current.apparentTemperature;
  if (feels < 5) {
    tips.push("厚外套");
  } else if (feels < 12) {
    tips.push("外套");
  } else if (feels < 18) {
    tips.push("长袖");
  } else if (feels < 25) {
    tips.push("长袖或短袖");
  } else {
    tips.push("短袖");
  }

  if (uvIndexMax !== null) {
    if (uvIndexMax < 3) {
      tips.push("无需防晒");
    } else if (uvIndexMax < 6) {
      tips.push("注意防晒");
    } else if (uvIndexMax < 8) {
      tips.push("涂防晒");
    } else {
      tips.push("强防晒");
    }
  }

  const aqi = airQuality?.aqi ?? null;
  if (RAIN_SNOW_CODES.includes(current.code)) {
    tips.push("不宜户外");
  } else if (aqi !== null && aqi > 150) {
    tips.push("不宜户外");
  } else if (current.windScale >= 5) {
    tips.push("户外注意防风");
  } else if (aqi !== null && aqi > 100) {
    tips.push("减少户外");
  } else {
    tips.push("宜户外活动");
  }

  return tips;
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  admin2?: string;
}

async function searchGeocode(query: string): Promise<GeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=zh`;
  const resp = await fetch(url);
  if (!resp.ok) {
    return [];
  }
  const json = await resp.json();
  return Array.isArray(json.results) ? json.results : [];
}

/** 地理编码结果与用户输入的匹配度，行政区划吻合时加分 */
function scoreGeoResult(item: GeoResult, input: string): number {
  let score = 0;
  const plainName = item.name.replace(/[区县市旗]$/, "");
  if (plainName && input.includes(plainName)) {
    score += 2;
  }
  for (const admin of [item.admin1, item.admin2]) {
    if (!admin) {
      continue;
    }
    const plainAdmin = admin.replace(/[省市自治区]$/, "");
    if (plainAdmin && input.includes(plainAdmin)) {
      score += 2;
    }
  }
  return score;
}

/**
 * 地区名 → 经纬度。支持区县级名称，如"嘉定区"、"上海嘉定区"、"上海市嘉定区"：
 * 既要尝试补全"区/县"后缀，也要逐字去掉上级行政区再查询，最后按行政区匹配度择优。
 */
async function geocodeCity(city: string): Promise<{ latitude: number; longitude: number } | null> {
  const input = city.replace(/\s+/g, "");
  const candidates: string[] = [];
  for (let i = 0; i < input.length - 1; i++) {
    const suffix = input.slice(i);
    candidates.push(suffix);
    if (!/[区县市旗]$/.test(suffix)) {
      candidates.push(`${suffix}区`, `${suffix}县`);
    }
  }

  let best: GeoResult | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    for (const item of await searchGeocode(candidate)) {
      const score = scoreGeoResult(item, input);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (bestScore >= 4) {
      // 名称与上级行政区都吻合，无需继续尝试
      break;
    }
  }
  return best ? { latitude: best.latitude, longitude: best.longitude } : null;
}

/**
 * 拉取最新天气并写入缓存。
 * 自动定位模式用设备坐标，自定义城市模式先做地理编码（结果回写到设置）。
 * 失败返回 null。
 */
export async function fetchAndCacheWeather(settings: Settings): Promise<WeatherData | null> {
  try {
    let latitude: number;
    let longitude: number;
    let locationKey: string;
    if (settings.locationMode === "device") {
      const loc = await resolveDeviceLocation();
      if (!loc.ok) {
        console.warn("[weather] 自动定位失败：", loc.reason);
        return null;
      }
      latitude = loc.latitude;
      longitude = loc.longitude;
      locationKey = `geo:${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    } else if (settings.locationMode === "manual") {
      const { manualLatitude, manualLongitude } = settings;
      if (manualLatitude === null || manualLongitude === null) {
        return null;
      }
      latitude = manualLatitude;
      longitude = manualLongitude;
      locationKey = manualLocationKey(manualLatitude, manualLongitude);
    } else {
      let lat = settings.latitude;
      let lon = settings.longitude;
      if (lat === null || lon === null) {
        const geo = await geocodeCity(settings.city);
        if (!geo) {
          return null;
        }
        lat = geo.latitude;
        lon = geo.longitude;
        await saveSettings({ ...settings, latitude: lat, longitude: lon });
      }
      latitude = lat;
      longitude = lon;
      locationKey = `city:${settings.city}`;
    }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current:
        "temperature_2m,weather_code,apparent_temperature,wind_speed_10m,wind_direction_10m,pressure_msl,relative_humidity_2m",
      hourly: "precipitation",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,uv_index_max",
      timezone: "auto",
      forecast_days: "4",
    });
    const [resp, airQuality] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${params}`),
      fetchAirQuality(latitude, longitude),
    ]);
    if (!resp.ok) {
      return null;
    }
    const json = await resp.json();

    const currentMapped = mapWeatherCode(json.current.weather_code);
    const daily: DailyForecast[] = [];
    for (let i = 1; i < json.daily.time.length && i <= 3; i++) {
      const date = new Date(`${json.daily.time[i]}T00:00:00`);
      const mapped = mapWeatherCode(json.daily.weather_code[i]);
      daily.push({
        weekday: WEEKDAYS[date.getDay()],
        label: mapped.label,
        icon: mapped.icon,
        tempMax: Math.round(json.daily.temperature_2m_max[i]),
        tempMin: Math.round(json.daily.temperature_2m_min[i]),
      });
    }

    const hourlyRain: HourlyRain[] = [];
    const hourlyTimes: string[] = json.hourly?.time ?? [];
    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);
    for (let i = 0; i < hourlyTimes.length; i++) {
      const time = new Date(hourlyTimes[i]);
      if (time.getTime() < currentHour.getTime()) {
        continue;
      }
      hourlyRain.push({
        hour: `${time.getHours()}时`,
        precipitation: Math.round((json.hourly.precipitation[i] ?? 0) * 10) / 10,
      });
      if (hourlyRain.length === RAIN_HOURS) {
        break;
      }
    }

    const data: WeatherData = {
      version: CACHE_VERSION,
      locationKey,
      current: {
        ...currentMapped,
        code: json.current.weather_code,
        temperature: Math.round(json.current.temperature_2m),
        apparentTemperature: Math.round(json.current.apparent_temperature),
        tempMax: Math.round(json.daily.temperature_2m_max[0]),
        tempMin: Math.round(json.daily.temperature_2m_min[0]),
        windDirection: mapWindDirection(json.current.wind_direction_10m),
        windScale: mapWindScale(json.current.wind_speed_10m),
        pressure: Math.round(json.current.pressure_msl),
        humidity: Math.round(json.current.relative_humidity_2m),
      },
      daily,
      hourlyRain,
      airQuality,
      uvIndexMax:
        typeof json.daily.uv_index_max?.[0] === "number"
          ? Math.round(json.daily.uv_index_max[0])
          : null,
      fetchedAt: Date.now(),
    };
    await Preferences.set({ key: CACHE_KEY, value: JSON.stringify(data) });
    return data;
  } catch {
    return null;
  }
}
