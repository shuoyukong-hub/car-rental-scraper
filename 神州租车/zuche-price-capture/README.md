# 神州租车价格抓取

这个工具走方案 A：打开真实 `m.zuche.com` 网页，使用 Chrome 登录态，监听车型接口 `/resource/carrctapi/order/chooseCar/v1`，把响应保存成 JSON，并递归提取价格字段为 CSV。

## 运行

```bash
cd ~/桌面/租车网站爬虫/神州租车/zuche-price-capture
node capture-zuche-prices.js
```

运行后会弹出一个移动端尺寸的 Chrome 窗口：

1. 如果提示登录，先完成登录。
2. 在网页中选择武汉、取还车时间、门店并进入车型列表。
3. 终端捕获到 `chooseCar` 后，会在 `output/` 下生成：
   - `chooseCar-response-*.json`：接口原始响应
   - `chooseCar-prices-*.csv`：提取出的价格字段
   - `chooseCar-request-*.json`：本次请求 URL 和表单体

Chrome 登录态保存在 `.chrome-profile/`，下次运行会复用。

## 已确认的网页端接口行为

- `chooseCar` 的真实接口路径是 `/resource/carrctapi/order/chooseCar/v1`
- 前端对该接口使用特殊网关：
  `/api/random/gw.do?v=<timestamp>&uri=/resource/carrctapi/order/chooseCar/v1`
- 请求体是表单格式：`data=<JSON字符串>`
- 登录失效时，前端会跳到 `/#/rlogin`

## 直接调用模式

如果已经从 `chooseCar-request-*.json` 或 DevTools 里拿到了 payload，可以复用登录态直接调：

```bash
node capture-zuche-prices.js --payload payload.json
```

`payload.json` 只放 `data` 里的 JSON 对象，不要包外层 `data=`。
