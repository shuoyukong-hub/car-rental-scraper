#!/usr/bin/env node
/**
 * hello_miniapp_query.js — 哈啰租车小程序「直调」脚本(照携程 ctrip_miniapp_query.js 方案)
 *
 * 背景:哈啰租车没有网页版,租车功能只在微信小程序(AppRentCarWechat)里。
 * 方案:WMPFDebugger(CDP)抓一次真实请求的登录态 → node 直调后端接口。
 *
 * 逆向/实测结论(详见 README.md):
 *   网关   : https://a.hellobike.com/rent/api/
 *   URL格式 : {网关}?{action}                     (action 拼在 query string,非 REST 路径)
 *   方法   : POST, Content-Type: application/json
 *   车列表 : quotation.veh.queryVehicleListPage   (分页,响应 data.totalVehicleNum 给总数)
 *   签名   : 默认关闭(chaos 远程配置默认 false)
 *   鉴权   : 需要 token(微信登录态),放在 body 里
 *   城市码 : **电话区号**(武汉=027),不是行政区划码 420100
 *
 * 响应结构:
 *   data.vehicleList[]            每个条目 = 一个「车型组」
 *     ├─ vehicleDisplayInfo       展示层(标题 displayGroupTitle / 规格 vehicleDesc / 展示价)
 *     ├─ vehicleExtendInfo        商家层(company.companyName / brandName / cSide 价格 / 距离)
 *     ├─ ratesListNeedInfo        渠道/商品标识(channelCode / goodsId / merchantId)
 *     └─ childVehicleList[]       同车型下各商家报价 —— **外层是 child[0] 的副本**
 *   所以取价一律走 childVehicleList,为空才回退外层,避免重复行。
 *
 * 价格三套: cSide*=C端价(用户实付) / bSide*=B端结算价 / vehiclePrice.*=展示价。
 * 取数用 cSide(展示价多数情况等同,但出现过 c=57 / b=48 的平台加价情形)。
 *
 * 用法:
 *   node hello_miniapp_query.js --city 027 --pickup "2026-09-12 10:00:00" --return "2026-09-14 10:00:00"
 *   node hello_miniapp_query.js --city 027 --pickup 1 --return 3      # 数字=距今N天
 *
 * 会话:默认读同目录 session.json(公共参数+账号)。过期后重跑 cdp_capture.js 抓新 token 覆盖。
 */
const fs = require("fs");
const path = require("path");

// ---------- 常量 ----------
const GATEWAY = "https://a.hellobike.com/rent/api/";
const ACTION_LIST = "quotation.veh.queryVehicleListPage";
const SESSION_FILE = path.join(__dirname, "session.json");

const HEADERS = {
  xweb_xhr: "1",
  Referer: "https://servicewechat.com/wx6ee6550b839c3a87/353/page-frame.html",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 " +
    "MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF " +
    "WindowsWechat(0x63090a13) UnifiedPCLinuxWechat(0xf2741107) XWEB/14978",
  "Content-Type": "application/json",
};

// 榜单参数(小程序车型列表页固定带,照抄真实请求)
const VEHICLE_RANK_LIST = [
  ["通勤轿车榜", 1], ["中大型轿车榜", 2], ["通勤SUV榜", 3], ["中大型SUV榜", 4],
  ["商务车榜", 5], ["经济电车榜", 6], ["豪华体验榜", 8], ["豪华电车榜", 9],
  ["极速跑车榜", 10], ["新车试驾榜", 11],
].map(([rankDesc, rankType]) => ({ rankDesc, rankType }));

// ---------- 参数 ----------
function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : fallback;
}

const pad = (n) => String(n).padStart(2, "0");
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "2026-09-12 10:00:00" → 毫秒时间戳;纯数字 → 距今 N 天(小数可);缺省 → 距今 fallbackDays 天 */
function toTimestamp(v, fallbackDays) {
  if (!v) {
    const d = new Date();
    d.setDate(d.getDate() + fallbackDays);
    d.setHours(10, 0, 0, 0);
    return d.getTime();
  }
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Date.now() + Math.round(parseFloat(v) * 86400000);
  const d = new Date(v.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) throw new Error(`时间无法解析: ${v}`);
  return d.getTime();
}

/** 取车/还车点:默认武汉汉南通用航空机场 P1 停车场(实测可用的样例点) */
function rentalInfo(point, ts) {
  return {
    cityCode: point.cityCode,
    longitude: point.longitude,
    latitude: point.latitude,
    poiId: point.poiId,
    datetime: ts,
    adCode: point.adCode,
    cityName: point.cityName,
    locationName: point.locationName,
    addressName: point.addressName,
    address: point.address,
    addressDetail: point.addressDetail,
    poiWebType: "9999",
    typeName: point.typeName,
    thirdPoiName: point.thirdPoiName,
    thirdPoiType: point.thirdPoiType,
  };
}

// ---------- 会话加载 ----------
function loadSession(file) {
  if (!fs.existsSync(file)) throw new Error(`找不到会话文件 ${file}(先用 cdp_capture.js 抓一次)`);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!s.account || !s.account.token) throw new Error(`${file} 里没有 account.token`);
  return s;
}

// ---------- 请求 ----------
function buildBody(action, session, pickupInfo, dropoffInfo, pageIndex, pageSize) {
  const body = Object.assign(
    {
      action,
      withTimeShare: false,
      vehicleListType: 1,
      pageIndex,
      pageSize,
      pickupRentalInfo: pickupInfo,
      dropoffRentalInfo: dropoffInfo,
      groupCode: "116",
      sortType: 1,
      filter: [],
      vehicleRankAbResult: true,
      ethnicMinorityDriver: false,
      stationFilterAbGroup: 0,
      linkFilter: false,
      hitchCarJumpParamsDTO: {},
      vehicleModelIds: [],
      enablePlatSubsidy: true,
      vehicleRankList: VEHICLE_RANK_LIST,
      userLocation: { adCode: "", cityCode: "", cityName: "", latitude: "", longitude: "", poiId: "" },
      riskParams: { systemCode: "Ac4", userMobile: session.account.mobile },
      __sysTag: "",
      ssid: session.ssid || "",
    },
    session.common,
    session.account
  );
  if (session.enquiryId) body.enquiryId = session.enquiryId;
  return body;
}

async function post(action, body) {
  const res = await fetch(`${GATEWAY}?${action}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`${action} 返回非 JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.code !== 0) {
    const hint = json.code === 103 ? "(token 过期,重跑 cdp_capture.js 抓新的)" : "";
    throw new Error(`${action} 业务失败 code=${json.code} msg=${json.msg || json.message || ""} ${hint}`);
  }
  return json;
}

// ---------- 拍平 ----------
/** 从一条报价(外层或 child)抽一行 */
function rowFromQuote(vehicle, quote) {
  const di = vehicle.vehicleDisplayInfo || {};
  const ex = quote.vehicleExtendInfo || (vehicle.vehicleExtendInfo || {});
  const rl = quote.ratesListNeedInfo || (vehicle.ratesListNeedInfo || {});
  const title = di.title || {};
  return {
    vehicleName: title.displayGroupTitle || `${ex.brandName || ""}${ex.vehicleSeriesName || ""}`,
    brandName: ex.brandName || "",
    vehicleSeriesName: ex.vehicleSeriesName || "",
    vehicleDesc: (di.vehicleDesc || []).join("/"),
    vendorName: (ex.company || {}).companyName || "",
    channelCode: rl.channelCode || "",
    merchantId: rl.merchantId || "",
    dailyPrice: ex.cSideDailyPrice != null ? ex.cSideDailyPrice : (vehicle.dailyLowestPrice != null ? vehicle.dailyLowestPrice : ""),
    totalPrice: ex.cSideTotalPrice != null ? ex.cSideTotalPrice : (vehicle.lowestTotalPrice != null ? vehicle.lowestTotalPrice : ""),
    storeDistance: ex.dropoffStoreDistance != null ? ex.dropoffStoreDistance : "",
    vehicleGroup: di.groupName || "",
    platformCode: rl.platformCode || "",
    goodsId: rl.goodsId || "",
    vehicleModelId: ex.vehicleModelId || "",
    vehicleSeriesId: ex.vehicleSeriesId || "",
  };
}

/** 一个 vehicleList 条目 → 若干行。外层是 child[0] 的副本,有 child 就只取 child。 */
function rowsFromVehicle(vehicle, pageIndex) {
  const children = vehicle.childVehicleList || [];
  const quotes = children.length ? children : [vehicle];
  return quotes.map((q) => Object.assign(rowFromQuote(vehicle, q), { pageIndex }));
}

const CSV_COLUMNS = [
  "vehicleName", "brandName", "vehicleSeriesName", "vehicleDesc", "vendorName",
  "channelCode", "merchantId", "dailyPrice", "totalPrice", "storeDistance",
  "vehicleGroup", "platformCode", "goodsId", "vehicleModelId", "vehicleSeriesId", "pageIndex",
];

function csvEscape(v) {
  const t = v == null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
function writeCsv(file, rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((k) => csvEscape(r[k])).join(","));
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

// ---------- 主流程 ----------
async function main() {
  const session = loadSession(getArg("session", SESSION_FILE));

  const cityCode = getArg("city", "027");
  const pageSize = parseInt(getArg("page-size", "10"), 10);
  const maxPages = parseInt(getArg("max-pages", "50"), 10);
  const outDir = path.resolve(getArg("output-dir", path.join(__dirname, "captures")));

  const point = {
    cityCode,
    longitude: getArg("lng", "114.060978"),
    latitude: getArg("lat", "30.249724"),
    poiId: getArg("poi-id", " B0FFIIIE6K "),
    adCode: getArg("adcode", cityCode === "027" ? "420113" : ""),
    cityName: getArg("city-name", cityCode === "027" ? "武汉市" : ""),
    locationName: getArg("location", "武汉汉南通用航空机场P1停车场"),
    addressName: getArg("location", "武汉汉南通用航空机场P1停车场"),
    address: getArg("address", "通飞大道武汉汉南通用航空机场"),
    addressDetail: getArg("address", "通飞大道武汉汉南通用航空机场"),
    typeName: getArg("poi-type", "机场"),
    thirdPoiName: getArg("third-poi-name", "交通设施服务;机场相关;飞机场"),
    thirdPoiType: getArg("third-poi-type", "150104"),
  };

  const pickupTs = toTimestamp(getArg("pickup", ""), 1);
  const dropoffTs = toTimestamp(getArg("return", ""), 3);

  console.log(`[query] ${ACTION_LIST} city=${cityCode} (${point.cityName || "?"}) ` +
              `取=${fmtDate(new Date(pickupTs))} 还=${fmtDate(new Date(dropoffTs))}`);

  const allRows = [];
  let total = null;      // 接口给的「车型组」总数(data.totalVehicleNum)
  let groupsSeen = 0;    // 已收「车型组」数 —— 分页终止只认这个
  for (let page = 1; page <= maxPages; page++) {
    const body = buildBody(ACTION_LIST, session, rentalInfo(point, pickupTs), rentalInfo(point, dropoffTs), page, pageSize);
    const json = await post(ACTION_LIST, body);
    const data = json.data || {};
    const list = data.vehicleList || [];
    if (total == null && data.totalVehicleNum != null) total = data.totalVehicleNum;
    const rows = list.flatMap((v) => rowsFromVehicle(v, page));
    allRows.push(...rows);
    groupsSeen += list.length;
    console.log(`  page ${page}: 车型组 +${list.length} (累计 ${groupsSeen}/${total ?? "?"}) → 报价行 +${rows.length} (累计 ${allRows.length})`);
    // 终止:空页 / 不满一页 / 已收够车型组数。
    // ★ 别拿 allRows.length(报价行,已把 childVehicleList 拍平)比 total(车型组数):
    //   一个车型组常带多个商家 child,报价行数会先涨过 total,第一页都没翻完就误判「收完了」→ 数据静默截断。
    if (!list.length || list.length < pageSize || (total != null && groupsSeen >= total)) break;
    await new Promise((r) => setTimeout(r, 400)); // 温和些,别打太快
  }
  if (total != null && groupsSeen < total) {
    console.log(`  ⚠ 只收到 ${groupsSeen}/${total} 个车型组就停了(是 max-pages=${maxPages} 卡住了?)—— 数据不完整`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = fmtDate(new Date()).replace(/[: ]/g, "-");
  const base = `hello-${cityCode}-${stamp}`;
  const jsonFile = path.join(outDir, `${base}.json`);
  const csvFile = path.join(outDir, `${base}.csv`);
  fs.writeFileSync(jsonFile, JSON.stringify({ total, groupsSeen, rows: allRows }, null, 2));
  writeCsv(csvFile, allRows);

  console.log(JSON.stringify({
    接口车型组总数: total ?? "?",
    实收车型组: groupsSeen,
    产出报价行: allRows.length,
    车商数: new Set(allRows.map((r) => r.vendorName)).size,
    json: jsonFile,
    csv: csvFile,
  }, null, 2));
}

main().catch((e) => {
  console.error("[error]", e.message);
  process.exitCode = 1;
});
