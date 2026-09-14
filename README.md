# 租车数据抓取

> 从携程、哈啰、滴滴、神州四个平台抓取车型与价格数据,输出 CSV。

## 简介

四个国内租车平台的取数脚本集合。每个平台一个独立目录,各自带 README 记录该平台的接口协议、字段映射和踩过的坑。

本仓库同时是一个 Claude Code skill,`SKILL.md` 是给 agent 用的路由表和报错处置。

## 特性

- **四个平台** —— 携程 / 哈啰 / 滴滴 / 神州
- **输出统一** —— 每个平台都产出 CSV(价格表)和原始 JSON
- **开箱可用** —— 携程不需要任何登录态,克隆下来直接跑
- **可跨机器** —— 哈啰和滴滴支持导出会话文件,换台机器不必重装微信

## 环境要求

| 项 | 要求 |
|---|---|
| 操作系统 | Linux 桌面 |
| Node.js | **≥ 18**(脚本使用全局 `fetch`) |
| 微信 | PC Linux 版并登录 —— **仅哈啰 / 滴滴需要** |
| 浏览器 | 有头环境(需要 `DISPLAY`)—— **仅神州需要** |

**携程不依赖微信和浏览器。**

## 安装

```bash
git clone https://github.com/shuoyukong-hub/car-rental-scraper.git
cd car-rental-scraper
```

滴滴额外需要一个 npm 依赖:

```bash
cd 滴滴租车 && npm install
```

## 准备登录态

四个平台对登录的要求不同,**首次使用前请先看这张表**:

| 平台 | 要做什么 | 耗时 |
|---|---|---|
| 携程 | 不用准备 | 0 |
| 哈啰 | 用 WMPFDebugger 抓一次 token | ~10 分钟 |
| 滴滴 | 微信里打开一次滴滴租车小程序 | ~1 分钟 |
| 神州 | 在弹出的浏览器里登录一次 | ~2 分钟 |

### 携程

不用准备。仓库自带 `携程租车/ctrip_base_request.json`(是客户端配置,不是登录态),脚本会自动使用。

### 哈啰

前提:装了微信 PC 版并已登录。

1. 在微信里打开「哈啰租车」小程序,随便搜一次车型(不搜就抓不到请求)
2. 启动 WMPFDebugger —— 外部项目,不在本仓库;frida 注入需要 root

   ```bash
   cd <WMPFDebugger 目录>
   sudo "$(command -v node)" node_modules/ts-node/dist/bin.js src/index.ts --debug-main
   ```

3. 另开一个终端跑抓包,会自动生成 `session.json`

   ```bash
   cd 哈啰租车/hello-miniapp-query
   node cdp_capture.js
   ```

token 实测可存活约 2 个月,报 `code:103` 时才需要重新抓取。

也可以直接使用他人提供的 `session.json` —— 放进 `哈啰租车/hello-miniapp-query/` 即可,脚本只读该文件,不访问本机微信。

### 滴滴

前提:装了微信 PC 版并已登录。

1. 在微信里打开「滴滴租车」小程序,随便搜一次车型
2. 安装依赖

   ```bash
   cd 滴滴租车 && npm install
   ```

跨机器使用时,可用 `--save-session` 导出会话文件、`--session` 导入,无需安装微信。

### 神州

```bash
cd 神州租车/zuche-price-capture
node capture-zuche-prices.js
```

会弹出一个手机尺寸的 Chrome:

1. 在窗口中完成登录
2. 选择城市、取车地址、时间,点「去订车」
3. 价格自动写入 `output/`

登录态之后自动复用;失效时页面会跳转到 `/#/rlogin`,重新登录一次即可。

## 使用方法

```bash
# 携程
cd 携程租车 && node ctrip_miniapp_query.js --city 43

# 哈啰
cd 哈啰租车/hello-miniapp-query && node hello_miniapp_query.js --city 027

# 滴滴
cd 滴滴租车 && node didi_miniapp_query.js --city 广州

# 神州
cd 神州租车/zuche-price-capture && node capture-zuche-prices.js
```

### 参数说明

**各平台的 `--city` 含义不同**,不要混用:

| 平台 | `--city` 含义 | 示例 | 默认值 |
|---|---|---|---|
| 携程 | 携程 cityId | 三亚 `43` | 三亚 |
| 哈啰 | 电话区号 | 武汉 `027` | 武汉 |
| 滴滴 | 中文城市名 | 广州 | 广州 |
| 神州 | 无此参数,在页面里选 | — | 北京 |

通用参数:

| 参数 | 说明 | 默认 |
|---|---|---|
| `--pickup` | 取车时间,格式 `"YYYY-MM-DD HH:MM:SS"` | 距今 1 天 |
| `--return` | 还车时间 | 距今 3 天 |
| `--session` | 指定外部会话文件(哈啰 / 滴滴) | — |
| `--save-session` | 导出会话文件(滴滴) | — |

**价格与租期强相关**,建议显式指定取还车时间。

## 输出

| 平台 | 输出目录 |
|---|---|
| 携程 | `携程租车/captures/ctrip-direct/` |
| 哈啰 | `哈啰租车/hello-miniapp-query/captures/` |
| 滴滴 | `滴滴租车/captures/didi-direct/` |
| 神州 | `神州租车/zuche-price-capture/output/` |

每个平台产出 CSV 和原始 JSON 各一份。

## 项目结构

```
.
├── SKILL.md                        Claude Code skill 入口(路由表 / 报错处置)
├── scripts/                        通用小程序逆向工具(抓包 / 抽接口 / 解包)
├── 携程租车/                        脚本 + README
├── 哈啰租车/hello-miniapp-query/    脚本 + 抓包工具 + README
├── 滴滴租车/                        脚本 + package.json + README
└── 神州租车/zuche-price-capture/    脚本 + README
```

每个平台目录下的 README 记录了该平台的接口协议、字段映射和历史踩坑。第三方版权内容(小程序包、前端 JS)和一次性抓取产物不在仓库中,仅在本地保留。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 哈啰 `code:103` | token 过期 | 重新抓取,见「准备登录态」 |
| 滴滴 `errno:1005` | 登录票据失效 | 在微信里重新打开滴滴租车小程序 |
| 滴滴 `errno:1004` | 请求带了不该带的字段 | 见 `滴滴租车/README.md` |
| 神州提示「用户不存在」 | Cookie 失效 | 在弹出窗口里重新登录 |
| 报 `fetch is not defined` | Node 版本过低 | 升级到 Node 18+ |
| 报找不到 puppeteer | 依赖缺失 | `npm install puppeteer`,或设 `PUPPETEER_MODULE` |

外部依赖脚本会自动查找,找不到时可用环境变量指定:`WMPFDEBUGGER_DIR` / `PUPPETEER_MODULE` / `CHROME_PATH` / `CLASSIC_LEVEL_MODULE`。

## 免责声明

本项目仅供学习与技术研究使用。使用者应自行遵守各平台的服务条款及相关法律法规,不得用于商业用途或高频请求。因使用本项目产生的任何后果由使用者自行承担。

## 许可证

[MIT](LICENSE)
