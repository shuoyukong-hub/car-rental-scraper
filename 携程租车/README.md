# 携程租车直调

四平台里**最省事**的一个:**不需要任何登录态**,随时能跑。

## 方案

从微信小程序运行时目录抠出 `baseRequest`,POST 携程的公开搜索接口。

```
读  ~/.xwechat/radium/web/profiles/web_shell/Session Storage/   (LevelDB,明文)
抠  _wb_fetch_cache_18631%2Fconfig__{"baseRequest":{...}}
发  POST https://m.ctrip.com/restapi/soa2/18631/queryProducts
```

## ★ `baseRequest` 不是登录态

名字有误导性 —— 它**不是凭据**,是**客户端配置**。实测拆开看过,里面只有:

```
sourceFrom: ISD_C_WX      channelType: 7        platform: app_cw
clientVersion: 20260610114942                   clientid: 52271177496627192335
allianceInfo.allianceId: 263528    ← 微信渠道号,不是用户
extraMaps.*  ← 一百多项 AB 测试开关
```

**没有 token、没有 cookie、没有 uid**(`encryptUid` 是空的)。所以 `queryProducts` 是公开接口。

**证据**:2026-09-14 用 7 月 21 日的 `baseRequest` 照样跑通,产出 179 条。所以**不用担心它过期**。

抠不到时脚本会退回同目录的 `ctrip_base_request.json`(仓库内已有)。

## 运行

```bash
# 三亚(默认城市就是 43)
node ctrip_miniapp_query.js --city 43

# 指定取还车时间
node ctrip_miniapp_query.js --city 43 --pickup "2026-09-15 10:00:00" --return "2026-09-17 10:00:00"
```

| 参数 | 默认 |
|---|---|
| `--city` | `43`(三亚) |
| `--pickup` | 距今 1 天 10:00 |
| `--return` | 距今 3 天 10:00 |
| `--area` | 不传则取该城市第一个租车区域 |
| `--output-dir` | `captures/ctrip-direct/` |

产出:`captures/ctrip-direct/ctrip-<城市>-<区域>-<时间戳>.csv` + `.json`。

CSV 字段见脚本 `writeCsv` —— 含 `dailyPrice`(日租)、`originalDailyPrice`(原价)、`totalPrice`(总价)、`vendorName`(车商)。

## 备注

- 城市码是**携程自家的 cityId**(三亚=43),不是电话区号也不是行政区划码。换城市得先知道对应 id
- 需要 Node 18+(脚本用全局 `fetch` 和 `crypto.randomUUID`)
