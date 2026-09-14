#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

function loadPuppeteer() {
  // 不写死路径:按优先级找,可用 PUPPETEER_MODULE 覆盖
  const candidates = [
    "puppeteer",
    process.env.PUPPETEER_MODULE,
    path.join(
      os.homedir(),
      ".local/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer"
    ),
    "/usr/local/lib/node_modules/puppeteer",
    "/usr/lib/node_modules/puppeteer",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // Try the next known install location.
    }
  }

  throw new Error(
    "Cannot find puppeteer. Install it with: npm install puppeteer " +
      "(or point PUPPETEER_MODULE at an existing install)"
  );
}

/** Chrome 可执行文件:优先 CHROME_PATH,再试常见位置;都没有就交给 puppeteer 用自带的 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const puppeteer = loadPuppeteer();

const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, "output");
const PROFILE_DIR = path.join(ROOT, ".chrome-profile");
// ★ 实测接口是 v3(v1 是早期记的,已过时)。主流程靠下面的事件监听匹配 url.includes("chooseCar"),
//   所以常量写错也不影响抓取;但 --payload 直调模式会用这个常量,必须是正确版本。
const TARGET_API = "/resource/carrctapi/order/chooseCar/v3";
const PRICE_KEYS = new Set([
  "price",
  "amount",
  "total",
  "totalPrice",
  "orderPrice",
  "rentPrice",
  "rentalPrice",
  "dayPrice",
  "dailyPrice",
  "avgPrice",
  "averagePrice",
  "activityPrice",
  "memberPrice",
  "originalPrice",
  "marketPrice",
  "discountPrice",
  "basePrice",
]);
const NAME_KEYS = [
  "carName",
  "vehicleName",
  "vehicleModelName",
  "modelName",
  "seriesName",
  "carModelName",
  "brandName",
  "groupName",
  "className",
  "levelName",
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeJson(prefix, data) {
  const file = path.join(OUTPUT_DIR, `${prefix}-${timestamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function flattenObject(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value, nextKey, out);
    } else if (typeof value !== "object") {
      out[nextKey] = value;
    }
  }
  return out;
}

function findClosestName(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const item = stack[i];
    if (!item || typeof item !== "object") continue;
    for (const key of NAME_KEYS) {
      if (typeof item[key] === "string" && item[key].trim()) {
        return item[key].trim();
      }
    }
  }
  return "";
}

function collectPrices(value, stack = [], pathParts = [], rows = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectPrices(item, stack, pathParts.concat(String(index)), rows);
    });
    return rows;
  }

  if (!value || typeof value !== "object") return rows;

  const nextStack = stack.concat(value);
  for (const [key, child] of Object.entries(value)) {
    const nextPath = pathParts.concat(key);
    const numeric =
      typeof child === "number" ||
      (typeof child === "string" && /^-?\d+(\.\d+)?$/.test(child));

    if (numeric && PRICE_KEYS.has(key)) {
      rows.push({
        car: findClosestName(nextStack),
        field: key,
        price: child,
        path: nextPath.join("."),
        context: flattenObject(value),
      });
      continue;
    }

    collectPrices(child, nextStack, nextPath, rows);
  }

  return rows;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(prefix, rows) {
  const file = path.join(OUTPUT_DIR, `${prefix}-${timestamp()}.csv`);
  const headers = ["car", "field", "price", "path"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  }
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function summarizePrices(data) {
  const rows = collectPrices(data);
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.car}|${row.field}|${row.price}|${row.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  }
  return deduped;
}

async function installPageHelpers(page) {
  await page.evaluateOnNewDocument((targetApi) => {
    window.__zucheCapture = {
      async fetchChooseCar(payload) {
        const body = new URLSearchParams({
          data: JSON.stringify(payload),
        }).toString();
        const url = `/api/random/gw.do?v=${Date.now()}&uri=${encodeURIComponent(
          targetApi
        )}`;
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        });
        return response.json();
      },
    };
  }, TARGET_API);
}

async function main() {
  const payloadFile = process.argv.includes("--payload")
    ? process.argv[process.argv.indexOf("--payload") + 1]
    : null;

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: findChrome(),
    userDataDir: PROFILE_DIR,
    defaultViewport: {
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=430,920",
      "--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
  });

  const page = await browser.newPage();
  await installPageHelpers(page);

  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("chooseCar")) return;
    const postData = request.postData();
    console.log("\n[chooseCar request]", url);
    if (postData) {
      console.log(postData.slice(0, 2000));
      writeJson("chooseCar-request", { url, postData });
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("chooseCar")) return;
    console.log("\n[chooseCar response]", response.status(), url);
    try {
      const data = await response.json();
      const rawFile = writeJson("chooseCar-response", data);
      const rows = summarizePrices(data);
      const csvFile = writeCsv("chooseCar-prices", rows);
      console.log(`[saved] raw JSON: ${rawFile}`);
      console.log(`[saved] extracted CSV: ${csvFile}`);
      console.table(
        rows.slice(0, 30).map((row) => ({
          car: row.car,
          field: row.field,
          price: row.price,
          path: row.path,
        }))
      );
    } catch (error) {
      console.log("[warn] failed to parse chooseCar response:", error.message);
    }
  });

  await page.goto("https://m.zuche.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  if (payloadFile) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(payloadFile), "utf8"));
    const data = await page.evaluate((input) => {
      return window.__zucheCapture.fetchChooseCar(input);
    }, payload);
    const rawFile = writeJson("chooseCar-direct-response", data);
    const rows = summarizePrices(data);
    const csvFile = writeCsv("chooseCar-direct-prices", rows);
    console.log(`[saved] raw JSON: ${rawFile}`);
    console.log(`[saved] extracted CSV: ${csvFile}`);
  } else {
    console.log("\nChrome is open.");
    console.log("Log in if prompted, then complete the rental search in the page.");
    console.log(`Captured output will be written to: ${OUTPUT_DIR}`);
    console.log("Leave this terminal running until chooseCar returns.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
