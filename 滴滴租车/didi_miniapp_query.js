#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

// classic-level 是本目录的依赖(见 package.json),但也不写死:
// 依次试 本地 → 环境变量指定的 → wechat_capture 里那份旧的。
function loadClassicLevel() {
  const candidates = [
    "classic-level",
    process.env.CLASSIC_LEVEL_MODULE,
    path.join(os.homedir(), "桌面", "wechat_capture", "node_modules", "classic-level"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // 试下一个
    }
  }
  throw new Error(
    "找不到 classic-level。在本目录跑 `npm install`,或设 CLASSIC_LEVEL_MODULE 指向已有的安装"
  );
}

const { ClassicLevel } = loadClassicLevel();

const API_ROOT = "https://tyche.xiaojukeji.com/car/rental/guide/store";
const DEFAULT_LEVELDB = path.join(
  os.homedir(),
  ".xwechat/radium/web/profiles/web_shell/Local Storage/leveldb"
);

/**
 * 常用城市的取车点表。
 *
 * ★ 真正决定"查哪个城市"的是 poi.latitude/longitude —— 服务端据坐标算出自己的
 *   `didi_city_id`(实测广州坐标 → didi_city_id=3),而 JSON 里传的 `city_id`
 *   基本只是回显。所以每条记录的关键是经纬度。
 * ★ 坐标为机场已知坐标;`cityId` 除广州(32,实测)外是推测值,不确定时用
 *   --city-id 覆盖。点不精确就用 --lat/--lng/--location 直接指定。
 */
const CITIES = {
  广州: { cityId: 32, latitude: 23.38655, longitude: 113.30308, location: "广州白云国际机场T1航站楼" },
  北京: { cityId: 1, latitude: 40.0799, longitude: 116.6031, location: "北京首都国际机场T3航站楼" },
  上海: { cityId: 2, latitude: 31.1979, longitude: 121.3363, location: "上海虹桥国际机场T2航站楼" },
  深圳: { cityId: 4, latitude: 22.6394, longitude: 113.8134, location: "深圳宝安国际机场T3航站楼" },
  成都: { cityId: 28, latitude: 30.5785, longitude: 103.9471, location: "成都天府国际机场" },
  杭州: { cityId: 5, latitude: 30.2295, longitude: 120.4355, location: "杭州萧山国际机场" },
  武汉: { cityId: 22, latitude: 30.7838, longitude: 114.2081, location: "武汉天河国际机场" },
  西安: { cityId: 26, latitude: 34.4471, longitude: 108.7515, location: "西安咸阳国际机场" },
  重庆: { cityId: 45, latitude: 29.7192, longitude: 106.6417, location: "重庆江北国际机场" },
  南京: { cityId: 6, latitude: 31.7421, longitude: 118.8624, location: "南京禄口国际机场" },
};

/** 服务端固定每页 10 个车型(实测传 page_size=20 也只回 10),别改 */
const PAGE_SIZE = 10;

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function parseStoredValue(buffer) {
  const text = buffer[0] === 0
    ? new TextDecoder("utf-16be").decode(buffer)
    : buffer.subarray(1).toString("utf8");
  let value = JSON.parse(text);
  for (let index = 0; index < 2 && typeof value === "string"; index += 1) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) break;
    value = JSON.parse(trimmed);
  }
  return value;
}

async function loadWechatSession(leveldbDir) {
  // ★ 目录不存在是常见情况(没装微信的新机器),要给能读懂的错误,
  //   不能把 fs 的 ENOENT 直接抛出去 —— 那个报错看不出该干嘛。
  if (!fs.existsSync(leveldbDir)) {
    throw new Error(
      `找不到微信 Local Storage:${leveldbDir}\n` +
        `  → 这台机器没装微信 PC Linux 版,或没在微信里打开过滴滴租车小程序。\n` +
        `  → 本机没有时,可改用 --session <文件> 从外部会话文件读(见 README)。`
    );
  }

  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "didi-rental-session-"));
  fs.cpSync(leveldbDir, snapshot, { recursive: true });
  fs.rmSync(path.join(snapshot, "LOCK"), { force: true });
  const wanted = new Set([
    "didih5_trinity_login_ticket",
    "securityParams",
    "UT_CAR_RENTAL_INFO",
  ]);
  const values = {};
  const db = new ClassicLevel(snapshot, {
    keyEncoding: "buffer",
    valueEncoding: "buffer",
  });
  try {
    await db.open();
    for await (const [key, value] of db.iterator()) {
      const name = key.toString("utf8").split("\u0001").pop();
      if (!wanted.has(name)) continue;
      try {
        values[name] = parseStoredValue(value);
      } catch (error) {
        // UT_CAR_RENTAL_INFO 解析失败不致命,但必须吭声 ——
        // 否则会静默退回硬编码取还车点(广州),拿到的城市和实际不符却毫无提示。
        if (name !== "UT_CAR_RENTAL_INFO") throw error;
        // 这个 blob 实测编码是坏的(UTF-16 字节序在同一串里不一致),基本必然解析失败。
        // 它只是"小程序上次选的地点"这个便利回退,不影响 --city 指定的查询,所以只是提示。
        console.warn(`[warn] UT_CAR_RENTAL_INFO 用不了(${error.message.slice(0, 50)}…)—— 不影响 --city 指定的查询`);
      }
    }
  } finally {
    await db.close().catch(() => {});
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
  if (!values.didih5_trinity_login_ticket || !values.securityParams) {
    throw new Error(
      "微信里没有滴滴租车的登录票据。\n" +
        "  → 在那台机器上用微信打开一次「滴滴租车」小程序并搜一次车型,再跑本脚本。"
    );
  }
  return values;
}

/**
 * 从外部会话文件读登录态 —— 让脚本可以跨机器用。
 * 在装了微信的机器上用 --save-session 导出一份,传到别处用 --session 读进来。
 */
function loadSessionFromFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`找不到会话文件:${file}`);
  }
  let session;
  try {
    session = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`会话文件不是合法 JSON:${file}(${error.message})`);
  }
  if (!session.didih5_trinity_login_ticket || !session.securityParams) {
    throw new Error(
      `会话文件里缺字段:${file}\n` +
        `  → 需要 didih5_trinity_login_ticket 和 securityParams 两个键。`
    );
  }
  console.log(`[session] 用外部会话文件 ${file}`);
  return session;
}

/** 把当前登录态导出成会话文件,方便传到别的机器 */
function saveSessionToFile(file, session) {
  const out = {
    _comment:
      "滴滴租车登录态。含登录票据,别提交到版本库、别随便外传。" +
      "在别的机器上可用 --session 指向本文件。",
    _exportedAt: new Date().toISOString(),
    didih5_trinity_login_ticket: session.didih5_trinity_login_ticket,
    securityParams: session.securityParams,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(`[session] 已导出登录态到 ${file}(含凭据,注意保管)`);
}

/** 距今 N 天的 17:00,格式 "YYYY-MM-DD HH:mm:ss" */
function dateFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 取还车相差几天(不足一天按一天算),用于把总租金折算成日租 */
function rentalDays(pickupTime, dropoffTime) {
  const a = new Date(String(pickupTime).replace(" ", "T"));
  const b = new Date(String(dropoffTime).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const days = Math.round((b - a) / 86400000);
  return days > 0 ? days : 1;
}

/** 从微信存储的 blob 里取取还车点;拿不到有效值就返回 null(绝不硬编码兜底) */
function rentalFromStored(stored) {
  if (!stored) return null;
  const info = stored.pickup_rental_info ? stored : stored.data || stored.rentalInfo || stored;
  const pickup = info && info.pickup_rental_info;
  const dropoff = info && (info.dropoff_rental_info || info.dropOff_rental_info);
  if (pickup && pickup.poi && dropoff && dropoff.poi) return { pickup, dropoff };
  return null;
}

/**
 * 组装取还车点,优先级:命令行(--city/--lat/--lng/--location) > 小程序上次选的 > 默认广州。
 * 时间用 --pickup/--return,没给就取「明天/后天 17:00」。
 */
function buildRental(args, stored) {
  const preset = args.city ? CITIES[args.city] : null;
  if (args.city && !preset) {
    throw new Error(
      `未知城市「${args.city}」。已知: ${Object.keys(CITIES).join("、")};` +
        `或者用 --lat/--lng/--location 直接指定坐标`
    );
  }

  if (preset || args.lat || args.lng || args.location) {
    const base = preset || CITIES.广州;
    const point = {
      location_type: 1,
      city_id: args.cityId ? Number(args.cityId) : base.cityId,
      location_code: null,
      location_name: args.location || base.location,
      poi: {
        latitude: args.lat ? Number(args.lat) : base.latitude,
        longitude: args.lng ? Number(args.lng) : base.longitude,
      },
      is_location: "",
    };
    console.log(`[geo] ${point.location_name} (${point.poi.latitude}, ${point.poi.longitude})`);
    return {
      pickup: { ...point, date_time: args.pickup || dateFromNow(1) },
      dropoff: { ...point, date_time: args.returnDate || dateFromNow(3) },
    };
  }

  const fromStored = rentalFromStored(stored);
  if (fromStored) {
    console.log(`[geo] 用小程序上次选的地点: ${fromStored.pickup.location_name}`);
    return {
      pickup: { ...fromStored.pickup, date_time: args.pickup || dateFromNow(1) },
      dropoff: { ...fromStored.dropoff, date_time: args.returnDate || dateFromNow(3) },
    };
  }

  console.log("[geo] 未指定 --city,且小程序地点不可用 → 默认广州白云机场");
  const base = CITIES.广州;
  const point = {
    location_type: 1,
    city_id: base.cityId,
    location_code: null,
    location_name: base.location,
    poi: { latitude: base.latitude, longitude: base.longitude },
    is_location: "",
  };
  return {
    pickup: { ...point, date_time: args.pickup || dateFromNow(1) },
    dropoff: { ...point, date_time: args.returnDate || dateFromNow(3) },
  };
}

function commonParams(session) {
  const security = session.securityParams;
  return {
    token: session.didih5_trinity_login_ticket,
    dchn: security.dchn || "J1WORmZ",
    platform: 3,
    access_key_id: 9,
    city_id: Number(security.cityId || 0),
    local_city_id: Number(security.cityId || 0),
    ...security,
  };
}

async function post(endpoint, body) {
  const startedAt = performance.now();
  const response = await fetch(`${API_ROOT}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": body.userAgent || "MicroMessenger/7.0.20",
    },
    body: JSON.stringify(body),
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  const json = await response.json();
  if (Number(json.errno) !== 0) {
    throw new Error(`${endpoint} failed: ${json.errno} ${json.errmsg || ""}`);
  }
  return { json, elapsedMs };
}

function buildPreloadBody(common, rental) {
  return {
    ...common,
    pickup_rental_info: rental.pickup,
    dropOff_rental_info: rental.dropoff,
    // ★ 不能带 times_card_id(preload 专属坑):带 false 服务端直接回 1004 参数错误。
    //   实测逐个字段隔离出来的,list/v2 不受影响。其余字段(dchn/city_id/loc_feature/context_id)都安全。
    loc_feature: 0,
    context_id: "",
  };
}

function buildListBody(common, rental, contextId, page, pageSize) {
  return {
    ...common,
    pickup_rental_info: rental.pickup,
    dropoff_rental_info: rental.dropoff,
    filter_info: { filter_codes: [], sort_code: "", group_code: "all" },
    page_size: pageSize,
    page,
    context_id: contextId,
    resource: 1,
    uid: "",
    query_id: "",
    phone: "",
  };
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number / 100).toFixed(2) : "";
}

/**
 * 日租(元)= total_charge.rental_amount(分)/ 100 / 天数。
 * ★ 不要用 daily_deduction_amount —— 那是「每日立减」,不是日租。
 *   实测样本:日立减 ¥2/¥10/¥16,而总租金 ¥100/¥106/¥122(2 天),量级完全对不上。
 */
function dailyRentalPrice(rate, days) {
  const rental = Number(rate.total_charge?.rental_amount);
  if (!Number.isFinite(rental) || rental <= 0) return "";
  return (rental / 100 / days).toFixed(2);
}

function flattenQuotes(response, days) {
  const data = response.data || {};
  const allGroup = (data.product_groups || []).find((group) => group.group_code === "all");
  const groups = allGroup ? [allGroup] : data.product_groups || [];
  const rows = [];
  for (const group of groups) {
    for (const product of group.product_list || []) {
      const vehicle = product.vehicle || {};
      for (const plate of product.plate_type_list || []) {
        for (const batch of plate.batch_list || []) {
          for (const supplier of batch.supplier_list || []) {
            for (const rate of supplier.veh_rates || []) {
              const pickupStore = rate.stores?.[0] || {};
              const returnStore = rate.stores?.[1] || {};
              rows.push({
                vehicleCode: vehicle.code,
                vehicleName: vehicle.name,
                brandName: vehicle.brand_name,
                category: vehicle.group_name,
                seats: vehicle.passenger_no,
                transmission: { 1: "自动", 2: "手动" }[vehicle.transmission_type] || "",
                fuelType: { 1: "汽油", 2: "柴油", 3: "混动", 4: "纯电动", 5: "其他", 301: "插混", 302: "增程" }[vehicle.fuel_type] || "",
                licenceName: plate.license_name || vehicle.licence_name,
                supplierName: rate.supplier_display_name || supplier.supplier_display_name || supplier.supplier_name,
                dailyPrice: dailyRentalPrice(rate, days),
                rentalAmount: cents(rate.total_charge?.rental_amount),
                dailyDeductionAmount: cents(rate.daily_deduction_amount_int),
                totalPrice: cents(rate.total_charge?.target_amount_int),
                originalTotalPrice: cents(rate.total_charge?.target_prepaid_discount_amount_int),
                pickupStore: pickupStore.name,
                pickupAddress: pickupStore.address,
                returnStore: returnStore.name,
                pickupDistanceKm: Number(rate.distance_to_pick_store || 0).toFixed(2),
                freeCancel: Boolean(rate.free_to_cancel),
                unlimitedMileage: Boolean(rate.unLimited),
                carCount: rate.car_number,
                tags: (rate.price_tag_list || []).map((tag) => tag.name).join("|"),
              });
            }
          }
        }
      }
    }
  }
  return rows;
}

/**
 * 响应里同一条报价会重复出现 —— 实测 38 组完全重复(plate/batch/choose_id/strategy_id 全一样),
 * 占 20% 虚高。按整行去重。真正有差异的行(不同门店/车数/价格)不受影响。
 * 去重前后数量都会打印,不做静默截断。
 */
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ["vehicleName"];
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

async function main() {
  const args = {
    city: getArg("city"),
    cityId: getArg("city-id"),
    lat: getArg("lat"),
    lng: getArg("lng"),
    location: getArg("location"),
    pickup: getArg("pickup"),
    returnDate: getArg("return"),
    maxPages: Number(getArg("max-pages", "80")),
    sessionFile: getArg("session"),
    saveSession: getArg("save-session"),
    leveldb: path.resolve(getArg("leveldb", DEFAULT_LEVELDB)),
    outputDir: path.resolve(getArg("output-dir", path.join(__dirname, "captures", "didi-direct"))),
  };
  if (getArg("page-size") && Number(getArg("page-size")) !== PAGE_SIZE) {
    console.warn(`[warn] --page-size 传了 ${getArg("page-size")},但服务端固定每页 ${PAGE_SIZE} 个车型,该参数无效`);
  }

  // 会话来源:--session 指定外部文件 > 本机微信 LevelDB
  const session = args.sessionFile
    ? loadSessionFromFile(path.resolve(args.sessionFile))
    : await loadWechatSession(args.leveldb);
  if (args.saveSession) saveSessionToFile(path.resolve(args.saveSession), session);
  const rental = buildRental(args, session.UT_CAR_RENTAL_INFO);
  const common = commonParams(session);
  const days = rentalDays(rental.pickup.date_time, rental.dropoff.date_time);

  // preload 一次拿 context_id,然后用它翻页
  const preload = await post("preload/v2", buildPreloadBody(common, rental));
  const contextId = preload.json.data?.context_id;
  if (!contextId) throw new Error("Preload response did not include context_id");

  const rawRows = [];
  const pages = [];
  let modelCount = 0;
  let totalModels = null;
  let listMs = 0;
  let hitMaxPages = true; // 只有翻到上限仍是满页才算被卡住

  for (let page = 1; page <= args.maxPages; page += 1) {
    const list = await post("list/v2", buildListBody(common, rental, contextId, page, PAGE_SIZE));
    listMs += list.elapsedMs;
    const data = list.json.data || {};
    if (totalModels == null && data.all_vehicle_num != null) totalModels = data.all_vehicle_num;
    const allGroup = (data.product_groups || []).find((group) => group.group_code === "all") || {};
    const models = (allGroup.product_list || []).length;
    const pageRows = flattenQuotes(list.json, days);
    rawRows.push(...pageRows);
    modelCount += models;
    pages.push({ page, models, quotes: pageRows.length });
    console.log(
      `  page ${page}: 车型 +${models} (累计 ${modelCount}/${totalModels ?? "?"}) → 报价 +${pageRows.length} (累计 ${rawRows.length})`
    );
    // 终止:空页 / 不满一页。all_vehicle_num 是车型总数,和报价行数不是一个量纲,别混着比。
    if (!models || models < PAGE_SIZE) {
      hitMaxPages = false;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (hitMaxPages) {
    console.log(`  ⚠ 翻到 --max-pages=${args.maxPages} 上限就停了 —— 数据可能不完整,加大该值`);
  } else if (totalModels != null && modelCount < totalModels) {
    // 服务端的 all_vehicle_num 和实际能翻出来的车型数会差 1~2(部分车型被过滤),属正常
    console.log(`  i 收尾:实收 ${modelCount} 车型,服务端标称 ${totalModels}(差值属正常)`);
  }

  const rows = dedupeRows(rawRows);
  fs.mkdirSync(args.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `didi-${rental.pickup.city_id}-${stamp}`;
  const jsonFile = path.join(args.outputDir, `${prefix}.json`);
  const csvFile = path.join(args.outputDir, `${prefix}.csv`);
  fs.writeFileSync(jsonFile, JSON.stringify({ pages, rawQuoteCount: rawRows.length, rows }, null, 2));
  writeCsv(csvFile, rows);
  console.log(JSON.stringify({
    pickup: `${rental.pickup.location_name} ${rental.pickup.date_time}`,
    return: `${rental.dropoff.location_name} ${rental.dropoff.date_time}`,
    days,
    pagesFetched: pages.length,
    preloadMs: preload.elapsedMs,
    listMs,
    totalVehicleCount: totalModels,
    rawQuoteCount: rawRows.length,
    exportedQuoteCount: rows.length,
    jsonFile,
    csvFile,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
