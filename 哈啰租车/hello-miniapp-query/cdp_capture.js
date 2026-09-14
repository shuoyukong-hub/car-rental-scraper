#!/usr/bin/env node
/**
 * cdp_capture.js — 连 WMPFDebugger 的 CDP 代理(62000),抓哈啰小程序的真实请求
 *
 * 目标:拿到 queryVehicleListPage 请求的完整 body(token / sid / webUserId / riskParams)
 * 以及响应结构,并**自动生成 session.json** —— 重抓登录态时不必再手工拼会话文件。
 *
 * 前提:WMPFDebugger 已启动(注入成功),小程序已重新打开并触发过一次租车查询。
 * 用法: sudo "$(command -v node)" cdp_capture.js
 *       (node 在 ~/.local/bin,sudo 下不在 PATH,所以用 command -v 取绝对路径)
 *       (node 在 ~/.local/bin,sudo 下不在 PATH,必须绝对路径)
 *
 * 产出:
 *   captures/cdp-<时间戳>.json   原始抓包(postData + 响应体),留档备查
 *   session.json                 从抓到的请求体里提取的登录态,hello_miniapp_query.js 直接可读
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// WMPFDebugger 目录里带着 ws,优先借用;找不到就退回普通 require("ws")。
// 路径不写死:默认按 home 推测,可用 WMPFDEBUGGER_DIR 覆盖。
const WMPF_DEBUGGER_DIR =
  process.env.WMPFDEBUGGER_DIR || path.join(os.homedir(), "桌面", "WMPFDebugger");

function loadWs() {
  const candidates = [path.join(WMPF_DEBUGGER_DIR, "node_modules", "ws"), "ws"];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // 试下一个
    }
  }
  throw new Error(
    `找不到 ws 模块。请设 WMPFDEBUGGER_DIR 指向 WMPFDebugger 目录(当前推测: ${WMPF_DEBUGGER_DIR})`
  );
}

const WebSocket = loadWs();

const CDP_URL = "ws://127.0.0.1:62000";
const CAPTURE_DIR = path.join(__dirname, "captures");
const SESSION_FILE = path.join(__dirname, "session.json");

// 会话字段白名单 —— 只从请求体里挑这些,其余(分页/取还车点/榜单等)属于单次查询参数,不进会话文件
const COMMON_KEYS = ["systemCode", "clientSystemCode", "clientSource", "adSource", "channelId",
                     "miniVersion", "appVersion", "sid", "webuserid", "pageSourceType",
                     "scene", "isNH5", "isAMap"];
const ACCOUNT_KEYS = ["token", "ticket", "mobile", "openId", "guid", "unionid",
                      "webUserId", "userNewId"];

const ws = new WebSocket(CDP_URL);
let seq = 0;
const pending = new Map();   // id -> {method, requestId}
const urlByRequest = new Map(); // requestId -> url
const capture = [];          // 抓到的原始条目

const pad = (n) => String(n).padStart(2, "0");
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  if (method === "Network.getRequestPostData") pending.set(id, { method, requestId: params.requestId });
  if (method === "Network.getResponseBody") pending.set(id, { method, requestId: params.requestId });
  return id;
}

const interesting = (url) =>
  /hellobike|queryVehicleListPage|rent\/api|rent-api/i.test(url || "");

function saveCapture(entry) {
  capture.push(entry);
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = path.join(CAPTURE_DIR, `cdp-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(capture, null, 2));
  return file;
}

/** 把 queryVehicleListPage 的请求体里的会话字段抽出来,覆盖写 session.json */
function writeSession(body, url) {
  const common = {};
  const account = {};
  for (const k of COMMON_KEYS) if (body[k] !== undefined) common[k] = body[k];
  for (const k of ACCOUNT_KEYS) if (body[k] !== undefined) account[k] = body[k];
  if (!account.token) {
    console.log("[session] ⚠ 请求体里没有 token,不覆盖 session.json");
    return null;
  }
  const session = {
    _comment: "哈啰小程序登录态会话。由 cdp_capture.js 从真实请求抓到,token 会过期,过期后重新抓并覆盖本文件。",
    _capturedAt: new Date().toISOString(),
    _sourceUrl: url,
    common,
    account,
  };
  if (body.ssid !== undefined) session.ssid = body.ssid;
  if (body.enquiryId !== undefined) session.enquiryId = body.enquiryId;
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  console.log(`[session] ✅ 已覆盖写 ${SESSION_FILE}(token ${String(account.token).slice(0, 12)}… / ssid ${body.ssid ?? "?"})`);
  return session;
}

/** 请求体是 JSON 就顺手落一次 session.json —— 这是「重抓 token 一条命令搞定」的关键 */
function handlePostData(requestId, postData, url) {
  console.log("\n=== [POST DATA] (requestId:", requestId, ") ===");
  console.log(postData);
  saveCapture({ type: "postData", requestId, url, postData, at: new Date().toISOString() });
  try {
    const body = JSON.parse(postData);
    const action = body.action || "";
    if (!/queryVehicleListPage/i.test(action) && !/queryVehicleListPage/i.test(url || "")) {
      console.log(`[session] 跳过(不是车列表请求,action=${action || "?"})`);
      return;
    }
    writeSession(body, url);
  } catch (_) {
    console.log("[session] postData 不是 JSON,跳过(留着原始抓包人工看)");
  }
}

ws.on("open", () => {
  console.log("[cdp] connected to", CDP_URL);
  send("Network.enable", {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 100000000,
    maxPostDataSize: 65536,
  });
  send("Runtime.enable");
  console.log("[cdp] Network.enable sent, waiting for miniapp requests...\n");
  console.log("[cdp] 请在小程序里触发一次租车车型查询(queryVehicleListPage)...\n");
});

ws.on("message", (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (_) { return; }

  // --- 命令响应(id) ---
  if (msg.id && pending.has(msg.id)) {
    const { method, requestId } = pending.get(msg.id);
    pending.delete(msg.id);
    const url = urlByRequest.get(requestId) || "";
    if (method === "Network.getRequestPostData" && msg.result && msg.result.postData) {
      handlePostData(requestId, msg.result.postData, url);
    } else if (method === "Network.getResponseBody" && msg.result && msg.result.body) {
      const body = msg.result.base64Encoded
        ? Buffer.from(msg.result.body, "base64").toString("utf8")
        : String(msg.result.body);
      console.log("\n=== [RESPONSE BODY] (requestId:", requestId, ") ===");
      console.log(body.slice(0, 20000));
      saveCapture({ type: "responseBody", requestId, url, body, at: new Date().toISOString() });
      try {
        const j = JSON.parse(body);
        console.log(`[response] code=${j.code} totalVehicleNum=${(j.data || {}).totalVehicleNum ?? "?"}`);
      } catch (_) { /* 非 JSON 就算了 */ }
    }
    return;
  }

  if (!msg.method) return;

  if (msg.method === "Network.requestWillBeSent") {
    const req = msg.params.request;
    const url = req.url || "";
    if (interesting(url)) {
      urlByRequest.set(msg.params.requestId, url);
      console.log("\n=== [REQUEST] " + req.method + " ===");
      console.log("url:", url);
      console.log("headers:", JSON.stringify(req.headers || {}, null, 2));
      if (req.postData) {
        handlePostData(msg.params.requestId, req.postData, url);
      } else {
        console.log("(postData 未随事件返回,尝试 getRequestPostData...)");
        send("Network.getRequestPostData", { requestId: msg.params.requestId });
      }
    }
  }

  if (msg.method === "Network.responseReceived") {
    const resp = msg.params.response;
    const url = resp.url || "";
    if (interesting(url)) {
      urlByRequest.set(msg.params.requestId, url);
      console.log("\n=== [RESPONSE] status:" + resp.status + " ===");
      console.log("url:", url);
      send("Network.getResponseBody", { requestId: msg.params.requestId });
    }
  }
});

ws.on("error", (e) => console.error("[cdp] error:", e.message));
ws.on("close", () => { console.log("\n[cdp] connection closed"); process.exit(0); });

setTimeout(() => {
  console.log(`\n[cdp] 300s 未抓到/超时,退出(本次抓到 ${capture.length} 条)`);
  process.exit(0);
}, 300000);
