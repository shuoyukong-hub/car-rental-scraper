# 哈啰租车小程序直调(照携程方案)

哈啰租车没有网页版,租车功能只在微信小程序(AppRentCarWechat)里。
携程走的是「抠登录态 → node 直调后端接口」,本目录复刻同套路。

**状态:2026-09-11 直调已跑通**(HTTP 200 / `code:0` / 武汉汉南机场 31 个车型组)。

## 目录

| 文件 | 说明 |
|------|------|
| `hello_miniapp_query.js` | 正式脚本。分页拉全量 → 拍平成 CSV + JSON |
| `session.json` | 登录态会话(common + account + ssid + enquiryId),脚本默认读它 |
| `cdp_capture.js` | 连 WMPFDebugger CDP 抓真实请求,**自动落盘并覆盖 `session.json`** |
| `test_direct.js` | 最早验证跑通的单次回放脚本(参数硬编码),留作兜底参照 |
| `captures/` | 抓包留档(`cdp-*.json`)与脚本产出(`hello-*.csv/json`) |

## 网关与协议(与携程的关键差异)

| 项 | 值 |
|----|----|
| 网关 | `https://a.hellobike.com/rent/api/`(生产 pro) |
| URL 格式 | `{网关}?{action}`(action 拼 query string,**非** REST 路径) |
| 方法 | POST,`Content-Type: application/json` |
| 车列表接口 | `quotation.veh.queryVehicleListPage`(分页) |
| 城市列表接口 | `timeshare.open.city.list`(返回 `openCityCodes`) |
| 签名/加密 | **默认关闭**(chaos 远程配置默认 false,`getSignature`/`encrypt` 是 throw 占位)→ 直调不需要签名 |
| 鉴权 | **需要 token**(车列表接口 `withToken:!0`),假 token 返回 `code:103` |

### 常量(实测值,逆向自 AppRentCarWechat)

```
systemCode  : "Ac4"          channelId   : "10"
businessType: "40"           clientSource: 60
adSource    : "wechatcarrentalmini"
miniVersion : "2.6.76"       appVersion  : "4.1.1.7"
appId       : "wx6ee6550b839c3a87"    // 哈啰租车微信小程序
```

> 城市码 = **电话区号**(武汉=`027`),不是行政区划码 `420100`。027 已实测可用。

### 请求头(必须装成微信小程序)

```
Referer: https://servicewechat.com/wx6ee6550b839c3a87/353/page-frame.html
xweb_xhr: 1
User-Agent: ...MiniProgramEnv/Windows ... XWEB/14978
Content-Type: application/json
```

## 会话里的运行时参数(缺一不可,全在 body 里)

`token`、`ticket`、`mobile`、`openId`、`unionid`、`guid`、`webUserId`/`webuserid`、
`userNewId`、`sid`、`session.ssid`、`riskParams:{systemCode,userMobile}`、`enquiryId`。

已落盘成 `session.json`(common + account + ssid + enquiryId),脚本默认读它。
**token 会过期**,过期后重抓覆盖(见下)。

## 响应结构与踩过的坑

```
data.vehicleList[]            每个条目 = 一个「车型组」
  ├─ vehicleDisplayInfo       展示层(displayGroupTitle / vehicleDesc[] / vehiclePrice / groupName)
  ├─ vehicleExtendInfo        商家层(company.companyName / brandName / cSide 价 / dropoffStoreDistance)
  ├─ ratesListNeedInfo        渠道标识(channelCode / goodsId / merchantId / platformCode)
  └─ childVehicleList[]       同车型下各商家报价
data.totalVehicleNum          车型组总数(分页用)
```

1. **外层条目 = `childVehicleList[0]` 的副本**(实测 10/10 `goodsId` 相同)
   → 拍平一律取 child,为空才回退外层,否则行重复。
2. **`totalVehicleNum` 是「车型组数」不是「报价行数」**
   → 一个车型组可能带多个商家 child,**分页终止不能用「报价行数 >= total」比**,
   要用「已收**车型组**数」。用错会第一页就误判收完,数据静默截断。
3. **价格有三套,别用错**:`cSideDailyPrice`/`cSideTotalPrice` = C 端价(用户实付,**比价用这个**);
   `bSide*` = B 端结算价;`vehicleDisplayInfo.vehiclePrice.*` + `dailyLowestPrice`/`lowestTotalPrice` = 展示价。
   多数情况展示价 = C 端价,但见过 `c=57 / b=48` 的平台加价情形。

## 运行

```bash
cd <本目录>

# 默认走武汉汉南机场 027,取车=明天10点 还车=后天10点
node hello_miniapp_query.js --city 027

# 指定时间(纯数字 = 距今 N 天)
node hello_miniapp_query.js --city 027 --pickup "2026-09-15 10:00:00" --return 1 --max-pages 50
```

产出 `captures/hello-<city>-<时间戳>.csv` 与 `.json`。

## token 过期后怎么重抓

前提:WMPFDebugger 已注入成功,且已在微信里打开哈啰租车小程序并触发过一次车型查询。

> **WMPFDebugger 是外部项目,不在本仓库内**,需要自行获取。
> 抓包脚本借它自带的 `ws` 模块,路径靠 `WMPFDEBUGGER_DIR` 环境变量指定。
> 另外**必须在微信里手动打开哈啰租车小程序并搜一次车型**,否则抓不到请求。

```bash
# 1. 起 WMPFDebugger(frida 注入需 root;node 在 ~/.local/bin,sudo 下不在 PATH,必须绝对路径)
cd <WMPFDebugger 目录>
sudo "$(command -v node)" node_modules/ts-node/dist/bin.js src/index.ts --debug-main

# 2. 另开一个终端跑抓包(会自动覆盖 session.json)
cd <本目录>
node cdp_capture.js
```

`cdp_capture.js` 会把原始抓包写进 `captures/cdp-<时间戳>.json`,
并**自动从请求体里抽出会话字段覆盖 `session.json`** —— 不用再手工拼。
抓完直接重跑 `hello_miniapp_query.js` 即可。
