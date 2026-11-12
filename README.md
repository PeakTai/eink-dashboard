# 墨水屏看板 · E-Ink Dashboard

为 7 寸墨水屏阅读器（1264×1680，3:4 竖屏）定制的天气看板 App。纯黑白配色、静态排版，靠整页刷新驱动更新，尽量让墨水屏只做「全刷」不做局部动画。

基于 [Capacitor](https://capacitorjs.com/) + Vite + TypeScript + [wok-ui](https://gitee.com/tai/wok-ui) 开发。

## 功能

- **日期与农历**：公历日期、星期、农历、当日节日或节气
- **大号时钟**：240px 数字，整分钟跳变
- **当前天气**：天气图标、温度、体感、最高最低温、湿度
- **空气质量**：AQI 数值与等级、PM2.5 浓度
- **气象指标**：风向风力、气压、紫外线指数
- **生活建议**：按体感温度、紫外线、空气质量、雨雪与风力自动生成穿衣 / 防晒 / 户外提示
- **6 小时降雨**：逐小时降水量柱状图
- **3 日预报**：未来三天的天气图标与高低温
- **设备状态**：电量百分比、充电状态
- **位置来源**：自定义城市 / 手动经纬度 / 设备自动定位
- **刷新策略**：页面刷新间隔与天气更新间隔可分别设置；锁屏解锁回到前台会自动重排定时器并刷新过期数据
- **返回键**：主面板连按两次返回键退出，其余页面返回上一页

## 技术栈

| 分类 | 选型 |
|---|---|
| 框架 | Capacitor 8（Android） |
| 构建 | Vite 7 + TypeScript |
| UI | wok-ui + Font Awesome 5.15.4（本地） |
| 存储 | @capacitor/preferences（SharedPreferences） |
| 农历 | lunar-typescript |
| 天气 | [Open-Meteo](https://open-meteo.com/)（免费，无需 API Key） |

## 快速开始

```bash
npm install        # 安装依赖
npm run start      # 本地开发（浏览器 1264×1680 视口可预览设计稿效果）
npm run typecheck  # 类型检查
npm run build      # 构建前端产物到 dist/
```

## 打包 Android

```bash
npm run android        # 同步 dist 到原生工程并打包 debug APK
npm run android:build  # 先 build 再同步打包
```

产物路径：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

安装到设备前请先卸载旧包（`applicationId` 变更后会成为独立的 App）：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 项目结构

```
src/
├── pages/
│   ├── dashboard/     # 主面板：静态渲染 + 定时整页刷新
│   └── settings/      # 设置页：位置来源、刷新间隔
├── utils/
│   ├── settings.ts    # 设置的读写与版本迁移（Preferences）
│   └── weather.ts     # Open-Meteo 天气、地理编码、空气质量
├── css/global.less    # 全局样式与黑白主题
└── main.ts            # 路由入口、主题覆盖、返回键处理
android/               # Capacitor 原生工程（含全屏、屏幕常亮等原生改动）
```

## 设计说明

- **固定画布 + 等比缩放**：`.dash-stage` 固定 1264×1680，运行时用 JS 计算 `scale = min(视口宽/1264, 视口高/1680)`，整体 `transform` 缩放并居中，因此在任意 3:4 屏幕上排版一致
- **规避老 WebView 限制**：不使用 `inset` 简写与 flex `gap`，改用四向 `top/left/right/bottom` 与 `margin`
- **墨水屏友好**：全局禁用 transition / animation / box-shadow / 渐变，纯黑白
- **屏幕常亮**：`MainActivity` 通过 `FLAG_KEEP_SCREEN_ON` 保持前台常亮，退到后台或手动锁屏时自动失效
- **全屏沉浸**：使用 `WindowInsetsControllerCompat` 隐藏状态栏与导航栏

## 数据来源

天气、预报、空气质量均来自 [Open-Meteo](https://open-meteo.com/)，无需注册与 API Key：

- 天气预报：`api.open-meteo.com/v1/forecast`
- 空气质量：`air-quality-api.open-meteo.com/v1/air-quality`
- 地理编码：`geocoding-api.open-meteo.com/v1/search`

天气数据会缓存到本地，按设置的更新间隔判断是否过期；缓存结构或定位方式变化时旧缓存自动作废。
