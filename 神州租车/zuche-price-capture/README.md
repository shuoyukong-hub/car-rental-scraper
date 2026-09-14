# 神州租车价格抓取

打开真实 `m.zuche.com` 网页,复用 Chrome 登录态,监听车型接口,把响应存成 JSON 并提取价格为 CSV。

四平台里**唯一需要人工介入**的一个 —— 没有可直接直调的路径(取数必须先登录 + 在页面里选地点)。

## ★ 首次运行必须人工登录

登录态存在 `.chrome-profile/`,**该目录第一次用是空的**:

1. 跑脚本 → 弹出 Chrome
2. **在窗口里完成登录**(可以在页面里直接搜「我的」→ 登录)
3. 选城市 / 取车地址 / 时间 → 点「去订车」
4. `chooseCar` 触发后自动落盘

之后 `.chrome-profile/` 有内容了,再跑就自动复用,**不用重复登录**。

**怎么判断登录态失效**:接口 `getUserInfo/v1` 返回 `用户不存在`,或页面跳到 `/#/rlogin`。
失效后**只能人工重登一次**,没有绕过的办法。

## 运行

```bash
cd <本目录>
node capture-zuche-prices.js
```

产出都在 `output/`:

| 文件 | 内容 |
|---|---|
| `chooseCar-response-*.json` | 接口原始响应 |
| `chooseCar-prices-*.csv` | 提取出的价格字段 |
| `chooseCar-request-*.json` | 本次请求 URL 和表单体 |

**目前只提取 `dailyPrice` 一个字段**(CSV 的 `field` 列全是它),总价/门店没抓。要更全得扩 `PRICE_KEYS` 和提取逻辑。

## 已确认的接口行为(2026-09-14 实测)

- **实际接口是 `/resource/carrctapi/order/chooseCar/v3`** ——
  脚本常量 `TARGET_API` 里写的 `/chooseCar/v1` **是过时的**。
  监听用的是 `url.includes("chooseCar")`,所以 v3 也能抓到,但改协议时别被那个常量误导。
- 网关是 `POST https://m.zuche.com/api/gw.do?uri=<接口>`,表单格式 `data=<JSON字符串>`
- 登录失效时前端跳 `/#/rlogin`

### 它的请求体极简,可以直调

实测只有 8 个字段:

```json
{"pickupCityId":"1","pickupTime":"2026-09-14 13:30","returnCityId":"1",
 "returnTime":"2026-09-16 13:30","entrance":1,
 "userChooseLat":"39.514295","userChooseLon":"116.414348","holidaysWaitingFlag":0}
```

`pickupCityId` 就是城市(北京=1)。**拿到有效 Cookie 后完全可以直调,不必依赖 puppeteer** ——
想省掉浏览器这一步就从这儿下手。

### 顺带摸到的接口(不需要登录也能调)

| 接口 | 作用 |
|---|---|
| `/action/carrctapi/order/cityLocation/v1` | 坐标 → cityId(北京=1),body `{"lat":..,"lon":..}` |
| `/action/carrctapi/order/poiList/v1` | 地标/门店列表,body `{"cityId":"1"}` |
| `/resource/carrctapi/account/getUserInfo/v1` | 登录态检查 |

## 直接调用模式

如果已经从 `chooseCar-request-*.json` 或 DevTools 拿到 payload,可以复用登录态直接调:

```bash
node capture-zuche-prices.js --payload payload.json
```

`payload.json` 只放 `data` 里的 JSON 对象,不要包外层 `data=`。

## 依赖

`puppeteer`。脚本会自动在几处常见位置找(含 `~/.local/lib/node_modules/...`),
找不到就 `npm install puppeteer`,或设 `PUPPETEER_MODULE` 指向已有的安装。

Chrome 可执行文件默认自动探测 `/usr/bin/google-chrome` 等,可用 `CHROME_PATH` 覆盖。
需要**有头浏览器环境**(会弹窗,要有 `DISPLAY`)。
