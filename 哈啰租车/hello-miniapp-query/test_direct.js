#!/usr/bin/env node
/**
 * test_direct.js — 用 CDP 抓到的 token 直调 queryVehicleListPage,验证 + 看响应结构
 * 复刻小程序完整请求(header + body),只替换 datetime 为未来时间戳。
 *
 * ★ 已脱敏:登录态字段(token/ticket/手机号/openId/guid/unionid)都是占位符,不可直接运行。
 *   要真跑请用 hello_miniapp_query.js —— 它从 session.json 读,不要把真实值填回这里。
 */
const TOKEN = "<TOKEN — 见 session.json>";

// 抓到的完整公共/业务参数(除 datetime 外原样复刻)
const COMMON = {
  systemCode: "Ac4",
  clientSystemCode: 20,
  clientSource: 60,
  adSource: "wechatcarrentalmini",
  channelId: "10",
  miniVersion: "2.6.76",
  appVersion: "4.1.1.7",
  sid: "<webUserId / sid>",
  webuserid: "<webUserId / sid>",
  pageSourceType: "NATIVE",
  scene: 1101,
  isNH5: false,
  isAMap: false,
};

const ACCOUNT = {
  token: TOKEN,
  ticket: "<ticket — 见 session.json>",
  mobile: "<手机号>",
  openId: "<openId>",
  guid: "<guid>",
  unionid: "<unionid>",
  webUserId: "<webUserId / sid>",
  userNewId: "<userNewId>",
};

// 取还车点(抓自真实请求,武汉汉南机场)
function rentalInfo(daysFromNow) {
  const datetime = Date.now() + daysFromNow * 24 * 3600 * 1000;
  return {
    cityCode: "027",
    longitude: "114.060978",
    latitude: "30.249724",
    poiId: " B0FFIIIE6K ",
    datetime,
    adCode: "420113",
    cityName: "武汉市",
    locationName: "武汉汉南通用航空机场P1停车场",
    addressName: "武汉汉南通用航空机场P1停车场",
    address: "通飞大道武汉汉南通用航空机场",
    addressDetail: "通飞大道武汉汉南通用航空机场",
    poiWebType: "9999",
    typeName: "机场",
    thirdPoiName: "交通设施服务;机场相关;飞机场",
    thirdPoiType: "150104",
  };
}

const VEHICLE_RANK_LIST = [
  ["通勤轿车榜", 1], ["中大型轿车榜", 2], ["通勤SUV榜", 3], ["中大型SUV榜", 4],
  ["商务车榜", 5], ["经济电车榜", 6], ["豪华体验榜", 8], ["豪华电车榜", 9],
  ["极速跑车榜", 10], ["新车试驾榜", 11],
].map(([rankDesc, rankType]) => ({ rankDesc, rankType }));

function buildBody(action) {
  return Object.assign(
    {
      action,
      withTimeShare: false,
      vehicleListType: 1,
      pageIndex: 1,
      pageSize: 10,
      pickupRentalInfo: rentalInfo(1),
      dropoffRentalInfo: rentalInfo(3),
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
      riskParams: { systemCode: "Ac4", userMobile: "<手机号>" },
      __sysTag: "",
      ssid: "mronrggaiv7_2026-07-17",
      enquiryId: "d2d7b58faeeb4a388e11c247e7c52c82",
    },
    COMMON,
    ACCOUNT
  );
}

const HEADERS = {
  "xweb_xhr": "1",
  "Referer": "https://servicewechat.com/wx6ee6550b839c3a87/353/page-frame.html",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCLinuxWechat(0xf2741107) XWEB/14978",
  "Content-Type": "application/json",
};

async function post(action) {
  const url = "https://a.hellobike.com/rent/api/?" + action;
  const body = buildBody(action);
  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("[http]", res.status, action);
  return { status: res.status, text };
}

(async () => {
  const { status, text } = await post("quotation.veh.queryVehicleListPage");
  console.log("=== 原始响应(前 6000 字符) ===");
  console.log(text.slice(0, 6000));
  // 尝试解析并输出结构概览
  try {
    const j = JSON.parse(text);
    console.log("\n=== 顶层键 ===", Object.keys(j));
    if (j.data) {
      console.log("=== data 键 ===", Object.keys(j.data));
      const list = j.data.vehicleList || j.data.list || j.data.vehicleModels || j.data.vehicles || [];
      console.log("=== 车列表长度 ===", Array.isArray(list) ? list.length : "非数组");
      if (Array.isArray(list) && list[0]) {
        console.log("=== 第一辆车的键 ===", Object.keys(list[0]));
        console.log("=== 第一辆车(前 3000 字符) ===", JSON.stringify(list[0]).slice(0, 3000));
      }
    }
  } catch (e) {
    console.log("(响应非 JSON,或已截断)");
  }
})();
