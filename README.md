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

> **第一次用?先看下一节** —— 哈啰/滴滴/神州都需要先准备一次登录态,携程不用。

## 首次使用:怎么准备登录态

四个平台对登录的要求**完全不同**,这是最容易踩的坑。**先看你需要做多少事**:

| 平台 | 你要做什么 | 大约耗时 |
|---|---|---|
| **携程** | **什么都不用做** —— 拿到代码直接跑 | 0 |
| **哈啰** | 用 WMPFDebugger 抓一次 token | ~10 分钟 |
| **滴滴** | 在微信里**打开一次**滴滴租车小程序 | ~1 分钟 |
| **神州** | 在弹出的浏览器里**登录一次** | ~2 分钟 |

### 携程 —— 不用做任何事 ✅

它从微信 Session Storage 抠出来的 `baseRequest` **不是登录态**,而是**客户端配置**(渠道号、版本、一百多项 AB 开关),里面没有 token、没有 cookie、没有 uid。`queryProducts` 是公开搜索接口。

而且仓库里**自带一份 `携程租车/ctrip_base_request.json`**,没装微信的机器会自动用它 —— **实测在一台只有 Node 的机器上直接跑通,产出 178 条**。

所以携程不用准备任何东西:

```bash
cd 携程租车 && node ctrip_miniapp_query.js --city 43
```

### 哈啰 —— 需要用 WMPFDebugger 抓一次 token

车列表接口是 `withToken:!0`,假 token 返回 `code:103`。token 存在 `session.json`,**仓库里没有**(含凭据,被 gitignore)。

**前提**:Linux 上装了**微信 PC 版**并已登录。

```bash
# ① 微信里打开「哈啰租车」小程序,随便搜一次车型
#    (目的是让小程序发一次真实请求,不搜就抓不到)

# ② 起 WMPFDebugger(frida 注入需 root;node 若不在 PATH,用绝对路径)
cd <WMPFDebugger 目录>
sudo "$(command -v node)" node_modules/ts-node/dist/bin.js src/index.ts --debug-main

# ③ 另开一个终端抓包 —— 会自动生成/覆盖 session.json
cd <本仓库>/哈啰租车/hello-miniapp-query
node cdp_capture.js
```

> WMPFDebugger 是**外部项目,不在本仓库**,需要自行获取。

**之后不用反复抓** —— 实测 token 活了 **2 个月**(7/17 的会话用到 9/14 仍有效)。
脚本报 `code:103` 才需要重抓,**先试跑再说**。

**【另一条路】别人给你 `session.json`**:直接放进 `哈啰租车/hello-miniapp-query/` 就能跑 ——
脚本只读这个文件,**完全不碰本机微信**,换台机器也认。也可用 `--session <路径>` 指向别处。

> ⚠️ `session.json` 含登录 token,给别人等于借出你的哈啰登录态。

### 滴滴 —— 微信里打开一次小程序就行

登录票据从微信 Local Storage 读,脚本自己会去取,**不需要抓包、不需要额外工具**。

**前提**:Linux 上装了**微信 PC 版**并已登录。

1. 微信里打开「**滴滴租车**」小程序
2. 随便搜一次车型(选个城市和日期,让它把登录票据写进本地存储)
3. 之后直接跑脚本:

```bash
cd 滴滴租车 && npm install        # 首次要装依赖
node didi_miniapp_query.js --city 广州
```

脚本会先**拷一份 LevelDB 快照到临时目录再读**,不碰微信的原文件。

**【另一条路】跨机器用**,把它导出成会话文件带过去:

```bash
# 在装了微信的机器上导出
node didi_miniapp_query.js --city 广州 --save-session didi-session.json

# 另一台机器上直接用它 —— 不需要装微信
node didi_miniapp_query.js --session didi-session.json --city 广州
```

> ⚠️ 会话文件含登录票据,别提交、别随便外传。

### 神州 —— 在弹出的浏览器里登录一次

神州没有可直接直调的取数接口,走的是「真实浏览器 + 监听接口」。登录态存在
`神州租车/zuche-price-capture/.chrome-profile/`,**该目录第一次用是空的**。

```bash
cd 神州租车/zuche-price-capture && node capture-zuche-prices.js
```

跑起来会弹出一个手机尺寸的 Chrome:

1. **在窗口里完成登录**(手机号 + 验证码/密码)
2. 选**城市 / 取车地址 / 时间**
3. 点「**去订车**」进车型列表
4. `chooseCar` 随即被监听到,自动存成 `output/chooseCar-prices-*.csv`

**之后不用重复登录** —— `.chrome-profile/` 有内容了就自动复用。

**怎么知道登录失效了**:页面跳到 `/#/rlogin`,或接口 `getUserInfo/v1` 返回「用户不存在」。
失效后**只能人工重登一次**,没有绕过的办法。

**依赖**:puppeteer 会在几处常见位置自动找,找不到就 `npm install puppeteer`,或用 `PUPPETEER_MODULE` 指定。
需要**有头浏览器环境**(会弹窗,要有 `DISPLAY`)。

**已知待改进**:实际接口是 `chooseCar/v3`,脚本常量 `TARGET_API` 写的是 `/chooseCar/v1`(过时了,靠 `url.includes("chooseCar")` 才没出错);
目前只提取了 `dailyPrice` 一个字段,总价/门店没抓。

## 目录结构

```
租车网站爬虫/
├── SKILL.md                  skill 入口(前置条件 / 路由表 / 默认参数 / 报错处置)
├── README.md                 本文件
├── LICENSE                   MIT
├── .gitignore                忽略 依赖 / 登录态 / 缓存
├── scripts/                  跨平台通用的小程序逆向工具
│                              capture_miniapp.sh / extract_apis.py / unpack_wxapkg.py
├── 携程租车/                  ctrip_miniapp_query.js + README.md + ctrip_base_request.json
├── 哈啰租车/hello-miniapp-query/   脚本 + README.md + cdp_capture.js + test_direct.js
├── 滴滴租车/                  didi_miniapp_query.js + README.md + package.json
└── 神州租车/
    ├── zuche-price-capture/  capture-zuche-prices.js + README.md(.chrome-profile/ 是登录态,不入库)
    ├── zuche_cdp_read.py     CDP 读页面
    └── zuche_scroll_collect.py  滚屏采集
```

**只有上面这些进仓库。** 下面这些**只在你本地保留、被 `.gitignore` 挡掉**,因为它们是第三方版权内容或抓取产物,不适合随公开仓库分发:

| 本地目录 | 是什么 | 为什么不入库 |
|---|---|---|
| `哈啰租车/小程序源码包/` | 4 个 `.wxapkg` | 哈啰小程序的包文件,版权不归你 |
| `神州租车/zuche_js/` | 神州前端 JS | 同上 |
| `携程租车/ctrip_*.xml` | 携程 App 的 UI dump | 同上 |
| `神州租车/zuche_scroll_result*.json` | 早期采集的 77 车数据 | 抓来的真实业务数据 |
| 各平台 `captures/`、`output/` | 抓取产物 | 同上,且是一次性文件 |
| `*.session*.json`、`.chrome-profile/` | 登录凭据 | 泄露等于借出账号 |

> 这些是**逆向的依据**,删了以后要重新搞 —— 所以留在本地。别人 clone 仓库会看到文档里的结论,但拿不到原始素材。

**每个平台目录都有自己的 `README.md`**,协议细节、字段映射、踩过的坑都在那儿 —— `SKILL.md` 只做路由和前置条件。

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

- **神州的城市只能在页面里选**,没有命令行参数;且它只提取 `dailyPrice`,总价/门店没抓
- 滴滴 `--city` 表里除广州(`city_id=32`,实测)外,`city_id` 都是推测值。**换城市后建议核对输出里的门店地址**
- 滴滴读微信存储时,`UT_CAR_RENTAL_INFO` 那个值实测**编码是坏的**(UTF-16 字节序在同一串里不一致,ASCII 是大端、中文是小端),所以「小程序上次选的地点」这条回退路径基本用不了 —— 脚本会打 `[warn]`,改用 `--city` 指定
