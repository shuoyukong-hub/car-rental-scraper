---
name: car-rental-scraper
description: 租车比价数据抓取——携程/哈啰/滴滴/神州四平台车型与价格获取。涉及租车爬虫、租车比价、车型价格、携程租车/哈啰租车/滴滴租车/神州租车取数时使用。
version: 1.0.0
metadata:
  hermes:
    tags: [car-rental, ctrip, hellobike, didi, zuche, 租车, 比价, 爬虫]
---

# 租车比价爬虫

从携程、哈啰、滴滴、神州四个平台抓车型与价格,做比价。

## 路由表(先看这个)

| 平台 | 脚本 | 「城市」怎么传 | 登录态 | 状态 |
|---|---|---|---|---|
| **携程** | `携程租车/ctrip_miniapp_query.js` | `--city 43`(**携程 cityId**,三亚=43) | ❌ 不需要 | ✅ 已验证 |
| **哈啰** | `哈啰租车/hello-miniapp-query/hello_miniapp_query.js` | `--city 027`(**电话区号**,武汉=027) | ✅ 需要 token | ✅ 已验证 |
| **滴滴** | `滴滴租车/didi_miniapp_query.js` | `--city 广州`(**中文城市名**,查内置表) | ✅ 需要登录票据 | ✅ 已验证 |
| **神州** | `神州租车/zuche-price-capture/capture-zuche-prices.js` | **页面里手选** | ✅ 需要 Cookie,且**首次必须登录** | ✅ 已验证(半自动) |

**四个平台的「城市」语义完全不同**,别混用:携程是自家 cityId、哈啰是电话区号、滴滴是中文城市名、神州只能在页面里选。

## 登录态(最容易踩的坑)

| 平台 | 要什么 | 怎么拿 | 失效表现 |
|---|---|---|---|
| 携程 | **什么都不用** | — | — |
| 哈啰 | 微信登录态 `token` | CDP 抓真实请求 | `code:103 登录信息已失效` |
| 滴滴 | 微信登录票据 | 从微信 Local Storage 读 | `errno:1005 登录信息错误` |
| 神州 | 浏览器 Cookie | **首次搜索时人工登录一次** | `getUserInfo` 返回「用户不存在」 |

### ★ 神州:第一次搜索必须登录

神州没有可直接调用的取数接口,走的是「真实浏览器 + 监听接口」:

- 登录态存在 `神州租车/zuche-price-capture/.chrome-profile/`
- **该目录第一次用是空的 → 必须在弹出的 Chrome 里登录一次**,登录态才会写进去,后续运行自动复用
- 登录失效时页面会跳到 `/#/rlogin`,接口 `getUserInfo` 会返回 `用户不存在`
- 失效后**只能重新登录**(我无法代做),重登一次又能用很久

**注意:实际接口是 `chooseCar/v3`,不是脚本常量里的 `v1`** —— 监听是按 `url.includes("chooseCar")` 匹配的,所以 v3 也能抓到,但那个常量是过时的,改协议时别被它误导。

**它的请求体很简单**(实测只有 8 个字段),也就是说**拿到有效 Cookie 后完全可以直调**,不必依赖 puppeteer:

```
{"pickupCityId":"1","pickupTime":"2026-09-14 13:30","returnCityId":"1",
 "returnTime":"2026-09-16 13:30","entrance":1,
 "userChooseLat":"39.514295","userChooseLon":"116.414348","holidaysWaitingFlag":0}
```

`pickupCityId` 就是城市(北京=1,可由 `cityLocation/v1` 用坐标换出来)。**想省掉浏览器这一步就从这儿下手。**

### 哈啰 token 失效后重抓

```bash
# 1. 起 WMPFDebugger(frida 注入需 root;node 在 ~/.local/bin,sudo 下不在 PATH,必须绝对路径)
cd ~/桌面/WMPFDebugger
sudo "$(command -v node)" node_modules/ts-node/dist/bin.js src/index.ts --debug-main

# 2. 另开终端抓包(会自动落盘并覆盖 session.json)
cd ~/桌面/租车网站爬虫/哈啰租车/hello-miniapp-query
node cdp_capture.js
```

哈啰 token 实测**能活 2 个月**,所以**先试跑,别一上来就重抓**。

## 运行

```bash
# 携程(三亚)
cd ~/桌面/租车网站爬虫/携程租车
node ctrip_miniapp_query.js --city 43

# 哈啰(武汉 = 区号 027)
cd ~/桌面/租车网站爬虫/哈啰租车/hello-miniapp-query
node hello_miniapp_query.js --city 027

# 滴滴(中文城市名;全量约 56 页 / 38s)
cd ~/桌面/租车网站爬虫/滴滴租车
node didi_miniapp_query.js --city 广州

# 神州(会弹出 Chrome,登录 + 选好取车地址,chooseCar 自动落 CSV)
cd ~/桌面/租车网站爬虫/神州租车/zuche-price-capture
node capture-zuche-prices.js
```

产出都在各平台目录的 `captures/`(神州在 `output/`)下,CSV + 原始 JSON 各一份。

## 常见报错 → 处置

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 哈啰 `code:103` | token 过期 | 走上面的 CDP 重抓 |
| 滴滴 `errno:1004 参数错误` | **`preload/v2` 带了 `times_card_id`** | 见下方「滴滴的坑」,该字段已删 |
| 滴滴 `errno:1005` | 登录票据失效 | 在微信里重新打开滴滴租车小程序 |
| 神州 `用户不存在` / 跳 `/#/rlogin` | Cookie 失效 | **在弹出窗口里重新登录** |
| 神州报找不到 puppeteer | 依赖缺失 | 见下 |

### 滴滴的坑(改过的地方,别改回去)

- **`preload/v2` 绝对不能带 `times_card_id`** —— 带 `false` 服务端直接回 `1004 参数错误`。这是逐个字段隔离出来的,`list/v2` 不受影响。
- **日租取 `total_charge.rental_amount`(分)/ 天数**,不是 `daily_deduction_amount` —— 后者是「每日立减」,量级差一个数量级。
- **响应里同一报价会重复返**,实测约 20% 虚高,已按整行去重(去重前后数量都会打印)。
- **翻页:`page_size` 服务端固定 10**,没有 has_more,靠「不满一页」终止。

### 神州依赖

puppeteer 本机已有(v25.3.0,在 mermaid-cli 的 `node_modules` 里,脚本会自动按 `~/.local/lib/node_modules/...` 找到),**不用装**。

脚本不写死路径,可用环境变量覆盖:

| 变量 | 作用 |
|---|---|
| `PUPPETEER_MODULE` | 指定 puppeteer 模块路径 |
| `CHROME_PATH` | 指定 Chrome 可执行文件(默认自动探测 `/usr/bin/google-chrome` 等) |
| `WMPFDEBUGGER_DIR` | 指定 WMPFDebugger 目录(哈啰抓包借它的 `ws`) |

## 各平台协议速查

| | 携程 | 哈啰 | 滴滴 | 神州 |
|---|---|---|---|---|
| 网关 | `m.ctrip.com/restapi/soa2` | `a.hellobike.com/rent/api/` | `tyche.xiaojukeji.com/car/rental/guide/store` | `m.zuche.com/api/gw.do` |
| 形式 | REST 路径 | `?{action}` 拼 query | REST 路径 | `?uri=<接口>` |
| 步数 | 1 步 | 1 步 | **2 步**(preload→list) | 页面驱动 |
| 城市/坐标 | cityId | 电话区号 | 中文名→内置表(坐标定城市) | 页面选 |

四个平台的响应结构、字段映射、踩坑细节都在各自 README 里。

## 维护指引

- 改协议先看对应平台目录的 `README.md`,那里有实测结论
- 四平台都**会变**,脚本里凡是标 `★` 的注释都是踩过的坑,别当废话删
- 状态别乱标:没实跑过的写「未验证」,跑通的写「已验证」——**假状态比没状态更害人**
