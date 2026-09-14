---
name: car-rental-scraper
description: 租车比价数据抓取——携程/哈啰/滴滴/神州四平台车型与价格获取。涉及租车爬虫、租车比价、车型价格、携程租车/哈啰租车/滴滴租车/神州租车取数时使用。
version: 1.1.0
metadata:
  hermes:
    tags: [car-rental, ctrip, hellobike, didi, zuche, 租车, 比价, 爬虫]
---

# 租车比价爬虫

从携程、哈啰、滴滴、神州四个平台抓车型与价格。

## When to Use

**该用**:要跑这四个平台取数;脚本报错要排查;要新增平台或改协议。

**不该用**:只想随便看个价(直接上官网更快);平台不在这四个里;要下单改单——**这个 skill 只读不写**。

## 前置条件(先读这节)

| 项 | 要求 |
|---|---|
| 操作系统 | **Linux 桌面**。依赖微信 PC Linux 版的数据目录与有头浏览器 |
| Node | **≥ 18**(脚本用全局 `fetch`、`crypto.randomUUID`) |
| 微信 | 装了**微信 PC Linux 版**并登录,且开过对应小程序 |
| 网络 | 需能访问四个国内网关(境外 IP 可能触发风控) |

| 平台 | 除上面外还要准备什么 | 需要人工介入吗 |
|---|---|---|
| 携程 | 无(仓库内有兜底配置 `携程租车/ctrip_base_request.json`) | ❌ 全自动 |
| 哈啰 | 一个外部的 **WMPFDebugger** 项目 + root 权限,抓一次 token | ⚠️ 仅 token 过期时 |
| 滴滴 | 微信里**开过滴滴租车小程序**(登录票据从那儿读) | ❌ 票据有效时全自动 |
| 神州 | 一个能跑起来的有头浏览器 | ✅ **首次必须人工登录**,之后复用 |

**四个平台里只有携程换台机器就能直接跑** —— 另外三个都依赖你自己机器上的微信登录态。

## 路由表

| 平台 | 脚本(相对本仓库根) | 城市参数 | 登录态 | 状态 |
|---|---|---|---|---|
| **携程** | `携程租车/ctrip_miniapp_query.js` | `--city 43`(携程 cityId) | ❌ 不需要 | ✅ 已验证 |
| **哈啰** | `哈啰租车/hello-miniapp-query/hello_miniapp_query.js` | `--city 027`(电话区号) | ✅ 需要 token | ✅ 已验证 |
| **滴滴** | `滴滴租车/didi_miniapp_query.js` | `--city 广州`(中文城市名) | ✅ 需要登录票据 | ✅ 已验证 |
| **神州** | `神州租车/zuche-price-capture/capture-zuche-prices.js` | 页面里手选 | ✅ Cookie,**首次要登录** | ✅ 已验证(半自动) |

**「城市」四个平台语义完全不同,别混用。**

## 默认参数(不传参数会查到哪里)

| 平台 | 默认城市 | 默认取还时间 |
|---|---|---|
| 携程 | `43` = 三亚 | 距今 1 天 10:00 → 距今 3 天 10:00 |
| 哈啰 | `027` = 武汉 | 距今 1 天 10:00 → 距今 3 天 10:00 |
| 滴滴 | 无 → 退回**广州** | 距今 1 天 17:00 → 距今 3 天 17:00 |
| 神州 | 页面里选(默认北京) | 页面里选 |

**价格强依赖时间和租期,不问清楚就默认「明天→后天」是错的。**

## 城市参数怎么填

| 平台 | 规则 | 怎么拿全量 |
|---|---|---|
| 携程 | 携程自家 cityId(三亚=`43`) | 接口 `13609/getAreaList`,body `{"cid":<cityId>}` |
| 哈啰 | **电话区号**(武汉=`027`) | 接口 `timeshare.open.city.list` 返回 `openCityCodes`,**别靠猜** |
| 滴滴 | **中文城市名**,查脚本里的 `CITIES` 常量 | 该表**只有 10 城**(广州/北京/上海/深圳/成都/杭州/武汉/西安/重庆/南京);加城市要改常量 |
| 神州 | 页面里手选 | — |

哈啰的区号是带前导 0 的字符串;三亚这类四位区号**没实测过,建议用上面那个接口查**。

## 运行

```bash
# 携程(不需要登录,随时可跑)
cd 携程租车 && node ctrip_miniapp_query.js --city 43

# 哈啰
cd 哈啰租车/hello-miniapp-query && node hello_miniapp_query.js --city 027

# 滴滴(先装依赖)
cd 滴滴租车 && npm install && node didi_miniapp_query.js --city 广州

# 神州(会弹出 Chrome,首次要人工登录 + 选地点)
cd 神州租车/zuche-price-capture && node capture-zuche-prices.js
```

产出:`captures/` 下的 CSV + 原始 JSON(神州在 `output/`)。

## 常见报错 → 处置

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 携程说找不到 baseRequest | 没开过小程序且兜底文件缺失 | 微信里开一次携程租车小程序 |
| 哈啰 `code:103` | token 过期 | 用 WMPFDebugger 重抓,见 `哈啰租车/hello-miniapp-query/README.md` |
| 滴滴 `errno:1005` | 登录票据失效 | 微信里重新打开滴滴租车小程序 |
| 滴滴 `errno:1004` | 请求带了不该带的字段 | 见 `滴滴租车/README.md` 的「五个坑」 |
| 神州 `用户不存在` / 跳 `/#/rlogin` | Cookie 失效 | **在弹出窗口里重新登录** |
| 神州找不到 puppeteer | 依赖缺失 | `npm install puppeteer`,或设 `PUPPETEER_MODULE` |
| 报 `fetch is not defined` | Node < 18 | 升级 Node |

## 环境变量(脚本不写死路径)

| 变量 | 作用 |
|---|---|
| `WMPFDEBUGGER_DIR` | WMPFDebugger 目录(哈啰抓包借它的 `ws`) |
| `PUPPETEER_MODULE` | puppeteer 模块路径 |
| `CHROME_PATH` | Chrome 可执行文件 |
| `CLASSIC_LEVEL_MODULE` | `classic-level` 模块路径(滴滴读 LevelDB 用) |

## 维护指引

- **协议细节、字段映射、踩过的坑都在各平台目录的 `README.md` 里**,改协议先看那儿
- 脚本里凡是标 `★` 的注释都是踩坑记录,**别当废话删**
- 状态别乱标:没实跑过的写「未验证」——**假状态比没状态更害人**
