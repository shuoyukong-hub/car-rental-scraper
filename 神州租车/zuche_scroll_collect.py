#!/usr/bin/env python3
import json
import time
from urllib.request import urlopen

import websocket


def cdp_call(ws, method, params=None, call_id=[0]):
    call_id[0] += 1
    msg = {"id": call_id[0], "method": method}
    if params is not None:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        data = json.loads(ws.recv())
        if data.get("id") == call_id[0]:
            return data


def eval_js(ws, expr):
    res = cdp_call(ws, "Runtime.evaluate", {
        "expression": expr,
        "returnByValue": True,
        "awaitPromise": True,
    })
    return res.get("result", {}).get("result", {}).get("value")


EXTRACT_JS = r"""
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const depts = Array.from(document.querySelectorAll('.dept-item')).map((dept, deptIndex) => {
    const deptName = clean(dept.querySelector('.dept-info .name')?.innerText || dept.querySelector('.dept-info')?.innerText);
    const distance = clean(dept.querySelector('.dept-info .distance')?.innerText || '');
    const cars = Array.from(dept.querySelectorAll('.vehicle-item-wrap')).map((car, carIndex) => ({
      carIndex,
      name: clean(car.querySelector('.center .name')?.innerText),
      desc: clean(car.querySelector('.center .desc')?.innerText),
      priceText: clean(car.querySelector('.right .price')?.innerText || car.querySelector('.right')?.innerText),
      unit: clean(car.querySelector('.right .unit')?.innerText)
    })).filter((x) => x.name || x.priceText);
    return {deptIndex, deptName, distance, carCount: cars.length, cars};
  }).filter((x) => x.deptName || x.cars.length);
  return {
    url: location.href,
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    deptCount: depts.length,
    carCount: depts.reduce((n, d) => n + d.cars.length, 0),
    depts
  };
})()
"""


def main():
    targets = json.loads(urlopen("http://127.0.0.1:9222/json/list", timeout=3).read())
    page = next(
        t for t in targets
        if t.get("type") == "page" and "m.zuche.com" in t.get("url", "")
    )
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
    seen_depts = {}
    samples = []
    try:
        cdp_call(ws, "Runtime.enable")
        for step in range(13):
            snap = eval_js(ws, EXTRACT_JS)
            if snap:
                samples.append({
                    "step": step,
                    "scrollY": snap["scrollY"],
                    "scrollHeight": snap["scrollHeight"],
                    "deptCount": snap["deptCount"],
                    "carCount": snap["carCount"],
                })
                for dept in snap["depts"]:
                    key = dept["deptName"] + "|" + dept["distance"]
                    if key not in seen_depts or len(dept["cars"]) > len(seen_depts[key]["cars"]):
                        seen_depts[key] = dept
            if step == 12:
                break
            eval_js(ws, "window.scrollBy(0, Math.floor(window.innerHeight * 0.85)); true")
            time.sleep(2.5)
        result = {
            "samples": samples,
            "deptCount": len(seen_depts),
            "carCount": sum(len(d["cars"]) for d in seen_depts.values()),
            "depts": list(seen_depts.values()),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        ws.close()


if __name__ == "__main__":
    main()
