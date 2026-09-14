#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const API_ROOT = "https://m.ctrip.com/restapi/soa2";
const SESSION_DIR = path.join(
  os.homedir(),
  ".xwechat/radium/web/profiles/web_shell/Session Storage"
);

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

function defaultDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(10, 0, 0, 0);
  return formatLocalDate(date);
}

function loadCachedBaseRequest() {
  // 优先从微信 Session Storage 抠(本机装了微信、且开过携程租车小程序时才走得到)。
  // ★ 目录不存在是正常情况(没装微信的新机器),不能让它抛出去 ——
  //   以前这里直接 readdirSync,新机器上会 ENOENT 崩掉,连下面的兜底文件都到不了。
  let files = [];
  try {
    files = fs
      .readdirSync(SESSION_DIR)
      .map((name) => path.join(SESSION_DIR, name))
      .filter((file) => fs.statSync(file).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch (_) {
    // 没装微信 / 没开过小程序 —— 走兜底
  }

  for (const file of files) {
    const parts = fs.readFileSync(file).toString("latin1").split(/[^\x20-\x7e]+/);
    for (const part of parts) {
      const marker = "_wb_fetch_cache_18631%2Fconfig__%7B";
      if (!part.includes(marker)) continue;
      try {
        const cached = JSON.parse(decodeURIComponent(part.slice(part.indexOf("%7B"))));
        if (cached.baseRequest) {
          console.log("[session] 用微信 Session Storage 里的 baseRequest");
          return cached.baseRequest;
        }
      } catch (_) {
        // A partially written LevelDB record may be truncated; try the next one.
      }
    }
  }

  const fallback = path.join(__dirname, "ctrip_base_request.json");
  console.log(`[session] 微信里没找到,改用仓库自带配置 ${fallback}`);
  return JSON.parse(fs.readFileSync(fallback, "utf8"));
}

async function post(service, body) {
  const response = await fetch(`${API_ROOT}/${service}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "MicroMessenger/7.0.20",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}`);
  return response.json();
}

async function resolveArea(cityId, requestedAreaId) {
  const response = await post("13609/getAreaList", { cid: cityId });
  const areas = (response.areaList || []).flatMap((group) =>
    (group.areaInfoList || []).map((area) => ({ ...area, type: group.type }))
  );
  const area = requestedAreaId
    ? areas.find((item) => String(item.aid) === String(requestedAreaId))
    : areas[0];
  if (!area) throw new Error(`No rental area found for city ${cityId}`);
  return area;
}

function makePoint(area, date) {
  return {
    cityId: Number(area.cid),
    date,
    locationCode: String(area.aid),
    locationName: area.aname,
    locationType: area.type,
    poi: {
      latitude: Number(area.lat),
      longitude: Number(area.lon),
      radius: 0,
    },
    pickupOnDoor: 0,
    dropOffOnDoor: 0,
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function flattenPrices(response) {
  const vehicleNames = new Map(
    (response.vehicleList || []).map((vehicle) => [
      String(vehicle.vehicleCode || vehicle.code || vehicle.id || ""),
      vehicle.name || vehicle.vehicleName || vehicle.zhName || "",
    ])
  );
  const allGroup = (response.productGroups || []).find(
    (group) => group.groupCode === "all"
  );
  const groups = allGroup ? [allGroup] : response.productGroups || [];
  const rows = [];

  for (const group of groups) {
    for (const product of group.productList || []) {
      const vehicleCode = String(product.vehicleCode || "");
      for (const vendor of product.vendorPriceList || []) {
        const price = vendor.priceInfo || {};
        const reference = vendor.reference || {};
        rows.push({
          groupCode: group.groupCode,
          groupName: group.groupName,
          vehicleCode,
          vehicleName: vehicleNames.get(vehicleCode) || product.vehicleName || "",
          vendorName: vendor.vendorName,
          dailyPrice: price.currentDailyPrice,
          originalDailyPrice: price.currentOriginalDailyPrice,
          totalPrice: price.currentTotalPrice,
          currency: price.currentCurrencyCode,
          pickupStore: vendor.pStoreRouteDesc || reference.pStoreNav || "",
          vendorCode: reference.vendorCode,
          productId: reference.productId,
        });
      }
    }
  }
  return rows;
}

function writeCsv(file, rows) {
  const headers = [
    "groupCode",
    "groupName",
    "vehicleCode",
    "vehicleName",
    "vendorName",
    "dailyPrice",
    "originalDailyPrice",
    "totalPrice",
    "currency",
    "pickupStore",
    "vendorCode",
    "productId",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

async function main() {
  const cityId = Number(getArg("city", "43"));
  const areaId = getArg("area");
  const pickupDate = getArg("pickup", defaultDate(1));
  const returnDate = getArg("return", defaultDate(3));
  const outputDir = path.resolve(
    getArg("output-dir", path.join(__dirname, "captures", "ctrip-direct"))
  );

  const area = await resolveArea(cityId, areaId);
  const baseRequest = {
    ...loadCachedBaseRequest(),
    requestId: crypto.randomUUID(),
  };
  const request = {
    baseRequest,
    pickupPointInfo: makePoint(area, pickupDate),
    returnPointInfo: makePoint(area, returnDate),
    age: 30,
    adultNumbers: 1,
    childrenNumbers: 0,
    searchType: 1,
    modify: null,
    pageNum: 1,
    sortType: 1,
    productGroupCode: "all",
    productGroupCodeFirst: "",
    filters: [],
    tops: [],
    productFilter: {},
    queryListCacheId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    now: formatLocalDate(new Date()),
    extraMaps: { isFullSearch: true },
  };

  const response = await post("18631/queryProducts", request);
  if (!response.baseResponse?.hasResult) {
    throw new Error(
      `Query failed: ${response.baseResponse?.code} ${response.baseResponse?.message || response.baseResponse?.returnMsg}`
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `ctrip-${cityId}-${area.aid}-${stamp}`;
  const jsonFile = path.join(outputDir, `${prefix}.json`);
  const csvFile = path.join(outputDir, `${prefix}.csv`);
  const rows = flattenPrices(response);
  fs.writeFileSync(jsonFile, JSON.stringify(response, null, 2));
  writeCsv(csvFile, rows);

  console.log(
    JSON.stringify(
      {
        cityId,
        areaId: area.aid,
        areaName: area.aname,
        pickupDate,
        returnDate,
        productGroupCount: (response.productGroups || []).length,
        vehicleCount: (response.vehicleList || []).length,
        storeCount: (response.storeList || []).length,
        priceRowCount: rows.length,
        jsonFile,
        csvFile,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
