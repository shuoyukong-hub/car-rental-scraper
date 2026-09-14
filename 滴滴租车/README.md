# 滴滴租车直调

从微信 Local Storage 读登录票据,两步接口取报价。

## 方案

```
读  ~/.xwechat/radium/web/profiles/web_shell/Local Storage/leveldb   (LevelDB,二进制)
抠  _https://dtrip.xiaojukeji.com\x00\x01{didih5_trinity_login_ticket, securityParams}
发  POST https://tyche.xiaojukeji.com/car/rental/guide/store/preload/v2   → 换 context_id
    POST https://tyche.xiaojukeji.com/car/rental/guide/store/list/v2      → 拿报价
```

微信正占着这个 DB,脚本会**先拷快照到临时目录、删掉 `LOCK` 再读**,不碰原文件。

## 运行

```bash
npm install                  # 装 classic-level(必需)

node didi_miniapp_query.js --city 广州
node didi_miniapp_query.js --city 上海 --pickup "2026-09-15 17:00:00" --return "2026-09-17 17:00:00"
```

| 参数 | 默认 |
|---|---|
| `--city` | 不传 → 退回**广州** |
| `--pickup` | 距今 1 天 17:00 |
| `--return` | 距今 3 天 17:00 |
| `--max-pages` | `80` |
| `--page-size` | **无效**(服务端固定 10,传别的会告警) |
| `--lat` / `--lng` / `--location` / `--city-id` | 覆盖城市表里的坐标/名称 |
| `--output-dir` | `captures/didi-direct/` |

产出:`captures/didi-direct/didi-<city_id>-<时间戳>.csv`(22 列)。

## 城市怎么选

**决定城市的是 `poi.latitude/longitude`,不是 `city_id`** —— 服务端按坐标自己算 `didi_city_id`
(实测广州坐标 → `didi_city_id=3`),传进去的 `city_id` 基本只是回显。

所以脚本内置一张「中文城市名 → 坐标」表(`didi_miniapp_query.js` 里的 `CITIES` 常量):

```
广州 北京 上海 深圳 成都 杭州 武汉 西安 重庆 南京
```

**只有这 10 个城市,表外的会直接报错。** 加城市就改 `CITIES`,补一条
`{ cityId, latitude, longitude, location }` —— 关键填准经纬度和取车点名。

`city_id` 除广州(`32`,实测)外都是推测值;不确定就用 `--city-id` 覆盖,或直接
`--lat/--lng/--location` 指定坐标。**换城市后建议核对输出里的门店地址**。

## ★ 五个坑(都实测隔离出来的,别改回去)

1. **`preload/v2` 绝对不能带 `times_card_id`** —— 带 `false` 服务端直接回 `1004 参数错误`。
   这是逐个字段加进最小 body 隔离出来的:其余字段(`dchn`/`platform`/`access_key_id`/`city_id`/
   `loc_feature`/`context_id`)加上都没事。`list/v2` 不受影响。**这曾是它完全跑不通的唯一原因。**
2. **日租 = `total_charge.rental_amount`(分)/ 天数**。别用 `daily_deduction_amount` ——
   那是「每日立减」(实测 ¥2/¥10/¥16),量级和真日租差一个数量级。
   总价用 `total_charge.target_amount`(元)。实测自洽:日租×2 天 + ¥80 服务费 = 总价。
3. **响应里同一报价会重复返回**,约 20% 虚高(38 组完全重复,`choose_id`/`strategy_id`/batch 全一样,
   无法区分真假)→ 必须按整行去重。去重前后数量都会打印,不做静默截断。
4. **翻页:`page_size` 服务端固定 10**,**没有 has_more / 总页数字段**,只有 `all_vehicle_num`(车型总数)。
   终止靠「空页 / 不满一页」,别拿报价行数比车型数。
5. **城市由坐标决定**,见上。

## 已知问题

- **`UT_CAR_RENTAL_INFO` 的编码是坏的**:UTF-16 字节序在同一串里不一致(ASCII 大端、中文小端),
  四种解码全失败,JSON 在 position 95 崩。所以「小程序上次选的地点」这条回退路径基本用不了,
  脚本会打 `[warn]` 并改用 `--city`。**不用浪费时间修它。**
- `securityParams.cityId` / `longitude` / `latitude` 都是空字符串 —— 像页面运行时状态,不是持久配置。

## 依赖

`classic-level`(见 `package.json`)。不在本目录装也行,脚本会依次找
本地 → `CLASSIC_LEVEL_MODULE` 环境变量 → 兼容旧位置的兜底路径。
