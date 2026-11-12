import { CreateDomModuleOptions, FullRenderingModule, getRouter } from "wok-ui";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { Solar } from "lunar-typescript";
import { DEFAULT_SETTINGS, getSettings, Settings } from "../../utils/settings";
import {
  buildLifeTips,
  fetchAndCacheWeather,
  getCachedWeather,
  isWeatherStale,
  WeatherData,
} from "../../utils/weather";
import "./style.less";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/** 农历日期，如"十月初三"，并附带当日节日或节气 */
function formatLunar(d: Date): string {
  const lunar = Solar.fromDate(d).getLunar();
  const solar = lunar.getSolar();
  // 节日优先于节气，两者都没有时只显示农历
  const festival = [
    ...solar.getFestivals(),
    ...lunar.getFestivals(),
    ...solar.getOtherFestivals(),
    ...lunar.getOtherFestivals(),
  ][0] ?? lunar.getJieQi();
  const suffix = festival ? ` · ${festival}` : "";
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}${suffix}`;
}

/** 电量百分比 → Font Awesome 电池图标 */
function batteryIcon(percent: number, charging: boolean): string {
  if (charging) {
    return "fa-battery-full";
  }
  if (percent >= 90) return "fa-battery-full";
  if (percent >= 60) return "fa-battery-three-quarters";
  if (percent >= 40) return "fa-battery-half";
  if (percent >= 20) return "fa-battery-quarter";
  return "fa-battery-empty";
}

/**
 * 主面板：渲染后完全静止，由整页刷新驱动更新。
 * 刷新定时器按设置的间隔对齐边界触发 location.reload()。
 */

/** 设计稿尺寸：7 寸阅读器基准分辨率 1264×1680（3:4 竖屏） */
const STAGE_WIDTH = 1264;
const STAGE_HEIGHT = 1680;

export class DashboardPage extends FullRenderingModule {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private weather: WeatherData | null = null;
  private batteryPercent: number | null = null;
  private batteryCharging = false;
  private refreshTimer: number | undefined;
  private appStateListener: PluginListenerHandle | undefined;

  constructor() {
    super("dashboard-page");
    void this.init().catch((err) => console.error("[dashboard] init failed", err));
  }

  private async init(): Promise<void> {
    this.settings = await getSettings();
    this.weather = await getCachedWeather(this.settings);
    this.render();

    void this.loadBattery().catch((err) => console.error("[dashboard] loadBattery failed", err));
    if (isWeatherStale(this.weather, this.settings.weatherIntervalMin)) {
      const fresh = await fetchAndCacheWeather(this.settings);
      if (fresh) {
        this.weather = fresh;
        this.render();
      }
    }
  }

  private async loadBattery(): Promise<void> {
    try {
      const info = await Device.getBatteryInfo();
      if (typeof info.batteryLevel === "number") {
        this.batteryPercent = Math.round(info.batteryLevel * 100);
        this.batteryCharging = info.isCharging ?? false;
        this.render();
      }
    } catch {
      // 部分设备不支持电量读取，忽略
    }
  }

  /** 手动刷新天气：忽略缓存，拉取后重渲染 */
  private async refreshWeather(): Promise<void> {
    const fresh = await fetchAndCacheWeather(this.settings);
    if (fresh) {
      this.weather = fresh;
      this.render();
    }
  }

  mount(parentEl: Element): void {
    super.mount(parentEl);
    this.updateScale();
    window.addEventListener("resize", this.updateScale);
    this.scheduleRefreshTimer();
    // 监听锁屏解锁后回到前台，立即刷新并重排定时器
    void App.addListener("appStateChange", (state) => {
      if (state.isActive) {
        void this.onAppForeground().catch((err) =>
          console.error("[dashboard] onAppForeground failed", err),
        );
      }
    })
      .then((handle) => {
        this.appStateListener = handle;
      })
      .catch((err) => console.error("[dashboard] addListener failed", err));
  }

  destroy(): void {
    window.removeEventListener("resize", this.updateScale);
    window.clearTimeout(this.refreshTimer);
    void this.appStateListener?.remove().catch((err) =>
      console.error("[dashboard] listener.remove failed", err),
    );
    super.destroy();
  }

  /**
   * 设备锁屏期间浏览器定时器会被挂起，恢复前台后之前的 setTimeout 可能已过期，
   * 重新按间隔对齐边界调度一次整页刷新。
   */
  private scheduleRefreshTimer(): void {
    window.clearTimeout(this.refreshTimer);
    const intervalMs = this.settings.refreshIntervalMin * 60 * 1000;
    const delay = intervalMs - (Date.now() % intervalMs);
    this.refreshTimer = window.setTimeout(() => location.reload(), delay);
  }

  /** 锁屏解锁/切回前台：天气过期就立即刷新，顺便重取电量和重排定时器 */
  private async onAppForeground(): Promise<void> {
    this.scheduleRefreshTimer();
    void this.loadBattery();
    if (isWeatherStale(this.weather, this.settings.weatherIntervalMin)) {
      await this.refreshWeather();
    }
  }

  /** 以 1264×1680 设计稿为基准等比缩放，并居中到视口 */
  private updateScale = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    const root = document.documentElement.style;
    root.setProperty("--dash-scale", String(scale));
    root.setProperty("--dash-x", `${(width - STAGE_WIDTH * scale) / 2}px`);
    root.setProperty("--dash-y", `${(height - STAGE_HEIGHT * scale) / 2}px`);
  };

  protected buildContent(): void {
    const now = new Date();
    this.addChild({
      classNames: "dash-stage",
      children: [
        {
          classNames: "dash-date",
          children: [
            { tag: "span", innerText: formatDate(now) },
            { tag: "span", classNames: "dash-lunar", innerText: `农历${formatLunar(now)}` },
          ],
        },
        { classNames: "dash-time", innerText: formatClock(now) },
        { classNames: "dash-divider" },
        this.buildCurrentWeather(),
        this.buildRainChart(),
        { classNames: "dash-divider" },
        this.buildForecast(),
        { classNames: "dash-footer-space" },
        this.buildFooter(),
      ],
    });
  }

  private buildFooter(): CreateDomModuleOptions {
    const battery: CreateDomModuleOptions[] = [];
    if (this.batteryPercent !== null) {
      battery.push({
        classNames: "dash-battery",
        children: [
          {
            tag: "i",
            classNames: `fas ${batteryIcon(this.batteryPercent, this.batteryCharging)}`,
          },
          {
            tag: "span",
            innerText: `${this.batteryPercent}%${this.batteryCharging ? " 充电中" : ""}`,
          },
        ],
      });
    }
    return {
      classNames: "dash-footer",
      children: [
        {
          classNames: "dash-updated",
          children: [
            {
              tag: "span",
              innerText: this.weather
                ? `天气更新于 ${formatClock(new Date(this.weather.fetchedAt))}`
                : "天气不可用",
            },
            {
              tag: "i",
              classNames: "fas fa-sync-alt dash-refresh-icon",
              attrs: { "aria-label": "刷新天气" },
              onClick: () =>
                void this.refreshWeather().catch((err) =>
                  console.error("[dashboard] refreshWeather failed", err),
                ),
            },
          ],
        },
        {
          classNames: "dash-footer-right",
          children: [
            ...battery,
            {
              tag: "i",
              classNames: "fas fa-cog dash-settings-icon",
              attrs: { "aria-label": "设置" },
              onClick: () => getRouter().push("/settings"),
            },
          ],
        },
      ],
    };
  }

  private buildCurrentWeather(): CreateDomModuleOptions {
    const current = this.weather?.current;
    const air = this.weather?.airQuality;
    return {
      classNames: "dash-current",
      children: current
        ? [
            {
              classNames: "dash-current-left",
              children: [
                { tag: "i", classNames: `fas ${current.icon} dash-current-icon` },
                {
                  classNames: "dash-current-main",
                  children: [
                    { tag: "span", classNames: "dash-temp", innerText: `${current.temperature}°` },
                    { tag: "span", classNames: "dash-condition", innerText: current.label },
                  ],
                },
              ],
            },
            {
              classNames: "dash-current-info",
              children: [
                {
                  classNames: "dash-highlow",
                  innerText: `最高 ${current.tempMax}°  最低 ${current.tempMin}°  湿度 ${current.humidity}%`,
                },
                ...(air
                  ? [
                      {
                        classNames: "dash-aqi",
                        innerText: `空气质量 ${air.aqi} ${air.level}`,
                      },
                    ]
                  : []),
                this.buildMetrics(),
                this.buildTips(),
              ],
            },
          ]
        : [{ classNames: "dash-weather-empty", innerText: "天气加载中…" }],
    };
  }

  private buildMetrics(): CreateDomModuleOptions {
    const current = this.weather!.current;
    const uv = this.weather!.uvIndexMax;
    const pm25 = this.weather!.airQuality?.pm25;
    return {
      classNames: "dash-metrics",
      children: [
        {
          classNames: "dash-metric-row",
          innerText: [
            `体感 ${current.apparentTemperature}°`,
            uv === null ? null : `紫外线 ${uv}`,
            pm25 === undefined ? null : `PM2.5 ${pm25}`,
          ]
            .filter(Boolean)
            .join(" · "),
        },
        {
          classNames: "dash-metric-row",
          innerText: `${current.windDirection} ${current.windScale}级 · ${current.pressure}hPa`,
        },
      ],
    };
  }

  private buildTips(): CreateDomModuleOptions {
    const tips = buildLifeTips(this.weather!);
    return {
      classNames: "dash-tips",
      innerText: tips.join(" · "),
    };
  }

  private buildRainChart(): CreateDomModuleOptions {
    const hours = this.weather?.hourlyRain ?? [];
    // 以最大值归一化柱高，全为 0 时避免除以 0
    const max = Math.max(...hours.map((item) => item.precipitation), 1);
    return {
      classNames: "dash-rain",
      children: [
        { classNames: "dash-rain-title", innerText: "未来 6 小时降雨（mm）" },
        {
          classNames: "dash-rain-bars",
          children: hours.map((item) => ({
            classNames: "dash-rain-item",
            children: [
              {
                classNames: "dash-rain-value",
                innerText: item.precipitation > 0 ? String(item.precipitation) : "0",
              },
              {
                classNames: "dash-rain-bar-wrap",
                children: [
                  {
                    classNames: "dash-rain-bar",
                    attrs: { style: `height:${Math.round((item.precipitation / max) * 100)}%` },
                  },
                ],
              },
              { classNames: "dash-rain-hour", innerText: item.hour },
            ],
          })),
        },
      ],
    };
  }

  private buildForecast(): CreateDomModuleOptions {
    const daily = this.weather?.daily ?? [];
    return {
      classNames: "dash-forecast",
      children: daily.map((day) => ({
        classNames: "dash-forecast-item",
        children: [
          { classNames: "dash-forecast-weekday", innerText: day.weekday },
          { tag: "i", classNames: `fas ${day.icon} dash-forecast-icon` },
          { classNames: "dash-forecast-temp", innerText: `${day.tempMin}° / ${day.tempMax}°` },
        ],
      })),
    };
  }
}
