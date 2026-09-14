#!/usr/bin/env python3
import json
import sys
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
        raw = ws.recv()
        data = json.loads(raw)
        if data.get("id") == call_id[0]:
            return data


def main():
    targets = json.loads(urlopen("http://127.0.0.1:9222/json/list", timeout=3).read())
    pages = [t for t in targets if t.get("type") == "page" and "zuche.com" in t.get("url", "")]
    if not pages:
        print("No zuche.com page found on Chrome debugging port 9222", file=sys.stderr)
        return 1

    target = pages[0]
    ws = websocket.create_connection(
        target["webSocketDebuggerUrl"],
        timeout=5,
        suppress_origin=True,
    )
    try:
        cdp_call(ws, "Runtime.enable")
        expr = r"""
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const nodes = Array.from(document.querySelectorAll('body *'))
    .filter(visible)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      text: clean(el.innerText || el.textContent || '').slice(0, 300)
    }))
    .filter((x) => x.text)
    .slice(0, 500);

  const storage = {};
  for (const storeName of ['localStorage', 'sessionStorage']) {
    const store = window[storeName];
    storage[storeName] = {};
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      const value = store.getItem(key);
      storage[storeName][key] = value && value.length > 600 ? value.slice(0, 600) + '...[truncated]' : value;
    }
  }

  const appKeys = Object.keys(window).filter((k) =>
    /vue|pinia|store|car|rent|order|vehicle|zuche/i.test(k)
  ).slice(0, 80);

  return {
    url: location.href,
    title: document.title,
    bodyText: clean(document.body.innerText).slice(0, 12000),
    nodes,
    storage,
    appKeys
  };
})()
"""
        result = cdp_call(
            ws,
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
        )
        value = result.get("result", {}).get("result", {}).get("value")
        print(json.dumps(value, ensure_ascii=False, indent=2))
    finally:
        ws.close()
    time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
