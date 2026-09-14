# 租车网站爬虫

从**携程、哈啰、滴滴、神州**四个平台抓车型与价格,做比价。

本目录同时是一个 Claude Code skill —— 触发规则、路由表、报错处置见 [`SKILL.md`](SKILL.md)。本 README 讲的是**给人看的背景**:各平台怎么跑、为什么这么设计、哪些路线试过但放弃了。

## 现状速览

| 平台 | 取数方式 | 登录态 | 状态 | 最近产出(2026-09-14) |
|---|---|---|---|---|
| **携程** | 抠客户端配置 → node 直调 REST | ❌ **不需要** | ✅ 跑通 | 三亚 179 条 |
| **哈啰** | WMPFDebugger CDP 抓包 → node 直调 | ✅ token | ✅ 跑通 | 武汉 32 条 |
| **滴滴** | 读微信 Local Storage → node 直调 | ✅ 登录票据 | ✅ 跑通 | 广州 3017 条 |
| **神州** | puppeteer 开真实浏览器 + 监听接口 | ✅ Cookie,且**首次必须登录** | ✅ 跑通(半自动) | 北京 89 条 |

## 快速开始

```bash
# 携程(三亚;不需要登录,随时可跑)
cd 携程租车 && node ctrip_miniapp_query.js --city 43

# 哈啰(武汉 = 电话区号 027)
cd 哈啰租车/hello-miniapp-query && node hello_miniapp_query.js --city 027

# 滴滴(中文城市名;全量约 56 页 / 38s)
cd 滴滴租车 && node didi_miniapp_query.js --city 广州

# 神州(会弹出 Chrome)
cd 神州租车/zuche-price-capture && node capture-zuche-prices.js
```

产出落在各平台的 `captures/`(神州是 `output/`),CSV + 原始 JSON 各一份。

## 登录态

四个平台对登录的要求**完全不同**,这是最容易踩的坑:

### 携程 —— 什么都不需要

它从微信 Session Storage 抠出来的 `baseRequest` **不是登录态**,而是客户端配置(渠道号、版本、一百多项 AB 开关),里面没有 token、没有 cookie、没有 uid。`queryProducts` 是公开搜索接口。

**证据**:2026-09-14 用 7 月 21 日的 `baseRequest` 照样跑通,产出 179 条。所以携程**随时能跑,不看登录脸色**。

### 哈啰 —— 需要 token,但能活很久

车列表接口是 `withToken:!0`,假 token 返回 `code:103`。token 从 CDP 抓真实请求拿到,存在 `session.json`。

**实测 token 活了 2 个月**(7/17 的会话用到 9/14 仍有效)→ **过期不是必然,先试跑再决定要不要重抓**。

重抓流程见 `SKILL.md` 的「哈啰 token 失效后重抓」。

### 滴滴 —— 需要登录票据

从微信 Local Storage 的 LevelDB 里读 `didih5_trinity_login_ticket` / `securityParams`。注意微信正占着这个 DB,脚本会**先拷快照到临时目录再读**。

### ★ 神州 —— 第一次搜索必须登录

神州没有可直接直调的取数接口,走的是「真实浏览器 + 监听 `/resource/carrctapi/order/chooseCar/v1`」:

1. 登录态存在 `神州租车/zuche-price-capture/.chrome-profile/`
2. **该目录第一次用是空的 → 必须在弹出的 Chrome 里登录一次**,之后自动复用
3. 登录失效时,接口 `getUserInfo/v1` 会返回 `用户不存在`,页面跳 `/#/rlogin`
4. 失效后**只能人工重新登录**,没有绕过的办法

**依赖**:puppeteer 本机已有(v25.3.0,在 mermaid-cli 的 node_modules 里,脚本的备选路径正好命中),不用装。真缺了就 `npm install puppeteer`。

**实测有效流程**(2026-09-14):跑脚本 → 弹窗里登录 → 选城市/取车地址/时间 → 点「去订车」→ `chooseCar` 自动落盘 CSV。

两个待改进点:

1. **实际接口是 `chooseCar/v3`**,而脚本常量 `TARGET_API` 写的是 `/chooseCar/v1`(过时了)。因为监听用的是 `url.includes("chooseCar")` 才没出问题,但改协议时别被那个常量误导。
2. **请求体极简**(只有 8 个字段,见 `SKILL.md`),意味着**有有效 Cookie 就完全可以直调**,能省掉浏览器这一步。
3. 目前只提取了 `dailyPrice` 一个字段(CSV 的 `field` 列全是它),总价/门店没抓 —— 要更全的话得扩 `PRICE_KEYS` 和提取逻辑。

## 目录结构

```
租车网站爬虫/
├── SKILL.md                  skill 入口(路由表 / 报错处置 / 依赖)
├── README.md                 本文件
├── .gitignore                忽略 依赖 / 登录态 / 缓存
├── scripts/                  跨平台通用的小程序逆向工具
│                              capture_miniapp.sh / extract_apis.py / unpack_wxapkg.py
├── 携程租车/                  ctrip_miniapp_query.js + captures/
├── 哈啰租车/
│   ├── hello-miniapp-query/  正式脚本 + session.json + cdp_capture.js + captures/
│   └── 小程序源码包/          4 个 .wxapkg(全部哈啰逆向结论的唯一本地来源)
├── 滴滴租车/                  didi_miniapp_query.js + package.json + captures/
└── 神州租车/
    ├── zuche-price-capture/  capture-zuche-prices.js + .chrome-profile/ + output/
    ├── zuche_js/             神州前端 JS(逆向 chooseCar 接口的依据)
    └── zuche_scroll_*.json   早期滚屏采集到的 77 车数据(北京大兴机场)
```

**脚本里不写死绝对路径**。所有外部依赖都可用环境变量覆盖:`PUPPETEER_MODULE` / `CHROME_PATH` / `WMPFDEBUGGER_DIR` / `CLASSIC_LEVEL_MODULE`,详见 `SKILL.md`。

## 各平台技术路线

### 携程 —— 抠配置 + 直调 REST(最干净)

从 `~/.xwechat/radium/web/profiles/web_shell/Session Storage`(LevelDB,明文)抠出 `baseRequest`,POST 到 `m.ctrip.com/restapi/soa2/18631/queryProducts`。一步到位,不需要登录。

### 哈啰 —— CDP 抓包 + 直调 `?action`

没有网页版,功能只在微信小程序(AppRentCarWechat)。网关 `a.hellobike.com/rent/api/?{action}`(**action 拼 query string,不是 REST 路径**)。因为 token 存在加密 MMKV 里抠不出来,改走 WMPFDebugger 的 CDP 抓一次真实请求。

**两个坑**:① 城市码是**电话区号**(武汉=027),不是行政区划码;② `totalVehicleNum` 是**车型组数**,分页终止不能拿报价行数比,否则第一页就误判收完。

### 滴滴 —— 读本地存储 + 两步接口

网关 `tyche.xiaojukeji.com/car/rental/guide/store`,**两步**:`preload/v2` 换 `context_id` → `list/v2` 查报价。

**城市由坐标决定,不是 `city_id`** —— 服务端按 `poi.latitude/longitude` 自己算 `didi_city_id`(广州坐标→3),传进去的 `city_id` 基本只是回显。所以脚本内置了一张「城市名 → 坐标」表,`--city 上海` 查表换算。

响应是五层嵌套(`product_groups → product_list → plate_type_list → batch_list → supplier_list → veh_rates`),且**同一报价会重复返回约 20%**,脚本按整行去重。

### 神州 —— 真实浏览器 + 监听接口

打开 `m.zuche.com`,监听网关 `m.zuche.com/api/gw.do?uri=/resource/carrctapi/order/chooseCar/v1`(POST,`data=<JSON urlencode>`)。需要真实登录态,所以只能半自动。

已摸出的接口(不带登录也能调):

| 接口 | 作用 |
|---|---|
| `/action/carrctapi/order/cityLocation/v1` | 坐标 → cityId(北京=1) |
| `/action/carrctapi/order/poiList/v1` | 地标/门店列表 |
| `/resource/carrctapi/account/getUserInfo/v1` | 登录态检查 |

## 未采用的路线

这些探索过但没走通 / 被更好的方案取代,记录在此**免得以后重复踩**:

| 路线 | 为什么放弃 |
|---|---|
| 哈啰 APK 反编译 | 哈啰是 Taro 小程序路线更直接;APK 里的接口和签名逻辑没派上用场 |
| Appium 云真机 / 本地真机 | 需要真机 + 云端服务,不如 CDP 抓包干净;且 UI 自动化脆弱 |
| 微信 PC X11 自动化 | 依赖 xdotool 操作 GUI,环境限制多 |
| mitmproxy 抓包 | 需重启微信或杀小程序进程,代价大;WMPFDebugger 的 CDP 更省事 |
| 神州纯接口直调 | 没有登录态就走不通,只能靠真实浏览器 |

## 已知限制

- **神州输出的是北京大兴机场的数据**(早期滚屏采集那次),城市不可指定;要换城市得在页面里选
- 滴滴 `--city` 表里除广州(`city_id=32`,实测)外,`city_id` 都是推测值。**换城市后建议核对输出里的门店地址**
- 滴滴读微信存储时,`UT_CAR_RENTAL_INFO` 那个值实测**编码是坏的**(UTF-16 字节序在同一串里不一致,ASCII 是大端、中文是小端),所以「小程序上次选的地点」这条回退路径基本用不了 —— 脚本会打 `[warn]`,改用 `--city` 指定
