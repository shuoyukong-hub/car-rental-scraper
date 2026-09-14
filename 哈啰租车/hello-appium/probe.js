#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APPIUM = process.env.APPIUM_URL || "http://127.0.0.1:4723";
const OUT_DIR = path.resolve(__dirname, "out");

const targets = {
  wechat: {
    appPackage: "com.tencent.mm",
    appActivity: ".ui.LauncherUI",
  },
  hello: {
    appPackage: "com.hellobike.rentcar",
    appActivity: "com.hellobike.atlas.business.portal.PortalActivity",
  },
};

const targetName = process.argv[2] || "wechat";
const target = targets[targetName];

if (!target) {
  console.error(`Unknown target: ${targetName}`);
  console.error(`Use one of: ${Object.keys(targets).join(", ")}`);
  process.exit(2);
}

function request(method, endpoint, body) {
  const url = new URL(endpoint, APPIUM);
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = require(url.protocol === "https:" ? "https" : "http").request(
      url,
      {
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = text;
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            // Appium may return plain text for a few server endpoints.
          }
          if (res.statusCode >= 400) {
            reject(new Error(`${method} ${endpoint} -> ${res.statusCode}: ${text}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const session = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:appPackage": target.appPackage,
        "appium:appActivity": target.appActivity,
        "appium:noReset": true,
        "appium:newCommandTimeout": 180,
        "appium:autoGrantPermissions": false,
        "appium:ignoreHiddenApiPolicyError": true,
        "appium:skipDeviceInitialization": true,
        "appium:skipUnlock": true,
      },
    },
  });

  const sessionId = session.value.sessionId;
  console.log(`Session: ${sessionId}`);
  console.log(`Target: ${targetName} (${target.appPackage})`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const source = await request("GET", `/session/${sessionId}/source`);
  fs.writeFileSync(path.join(OUT_DIR, `${targetName}-source.xml`), source.value || source, "utf8");

  const screenshot = await request("GET", `/session/${sessionId}/screenshot`);
  fs.writeFileSync(
    path.join(OUT_DIR, `${targetName}-screenshot.png`),
    Buffer.from(screenshot.value, "base64")
  );

  console.log(`Wrote ${path.join(OUT_DIR, `${targetName}-source.xml`)}`);
  console.log(`Wrote ${path.join(OUT_DIR, `${targetName}-screenshot.png`)}`);

  await request("DELETE", `/session/${sessionId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

