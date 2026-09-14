#!/usr/bin/env python3
"""
从 mitmproxy flow 文件中提取 API 请求
用法: python3 extract_apis.py <flow文件> <输出目录>
"""
import sys
import json
import os
from urllib.parse import urlparse, parse_qs

def extract_apis(flow_path, output_dir):
    """解析 mitmproxy flow 文件，提取 API 请求"""
    
    if not os.path.exists(flow_path):
        print(f"错误: 文件不存在 {flow_path}")
        sys.exit(1)
    
    apis = []
    
    try:
        # mitmproxy flow 文件可以用 mitmproxy 自带的工具解析
        # 这里用 mitmdump 的 -r 模式重放并导出
        import subprocess
        result = subprocess.run(
            ['mitmdump', '-r', flow_path, '-n', '--flow-detail', '4'],
            capture_output=True, text=True, timeout=30
        )
        
        # 也可以用 Python 直接读 flow 文件
        from mitmproxy.io import FlowReader
        
        with open(flow_path, 'rb') as f:
            reader = FlowReader(f)
            for flow in reader.stream():
                req = flow.request
                resp = flow.response
                
                if not req or not resp:
                    continue
                
                url = req.pretty_url
                host = req.host
                path = req.path
                method = req.method
                
                # 只保留 API 请求
                is_api = any(kw in url.lower() for kw in 
                    ['api', 'rent', 'car', 'search', 'list', 'price', 'query',
                     'miniapp', 'wx', 'wxa', '小程序'])
                
                if not is_api:
                    continue
                
                # 提取请求和响应
                try:
                    req_body = req.get_text()
                    resp_body = resp.get_text()
                    
                    # 尝试解析 JSON
                    try:
                        req_json = json.loads(req_body) if req_body else {}
                    except:
                        req_json = req_body if req_body else {}
                    
                    try:
                        resp_json = json.loads(resp_body) if resp_body else {}
                    except:
                        resp_json = resp_body[:500] if resp_body else {}
                    
                    api = {
                        'url': url,
                        'host': host,
                        'path': path,
                        'method': method,
                        'status': resp.status_code,
                        'request_headers': dict(req.headers),
                        'request_body': req_json,
                        'response_body': resp_json,
                    }
                    apis.append(api)
                    
                except Exception as e:
                    print(f"  解析失败 {url}: {e}")
    
    except ImportError:
        print("警告: mitmproxy Python 库不可用，用 mitmdump 命令行解析...")
        import subprocess
        
        result = subprocess.run(
            ['mitmdump', '-r', flow_path, '-n', '--flow-detail', '4'],
            capture_output=True, text=True, timeout=60
        )
        
        # 保存原始输出
        raw_path = os.path.join(output_dir, 'traffic_dump.txt')
        with open(raw_path, 'w') as f:
            f.write(result.stdout)
        print(f"  原始流量已保存到: {raw_path}")
        return
    
    # 保存提取的 API
    api_path = os.path.join(output_dir, 'api_requests.json')
    with open(api_path, 'w', encoding='utf-8') as f:
        json.dump(apis, f, ensure_ascii=False, indent=2)
    
    print(f"\n提取到 {len(apis)} 个 API 请求:")
    for api in apis:
        print(f"  [{api['status']}] {api['method']} {api['host']}{api['path']}")
    
    print(f"\n保存到: {api_path}")
    
    # 额外：提取看起来像价格的响应
    price_apis = []
    for api in apis:
        resp = json.dumps(api['response_body'], ensure_ascii=False)
        if any(kw in resp for kw in ['price', 'amount', '¥', '元', 'daily', 'total', 'car', '车型']):
            price_apis.append(api)
    
    if price_apis:
        price_path = os.path.join(output_dir, 'price_apis.json')
        with open(price_path, 'w', encoding='utf-8') as f:
            json.dump(price_apis, f, ensure_ascii=False, indent=2)
        print(f"可能的定价请求: {len(price_apis)} 个 → {price_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python3 extract_apis.py <flow文件> <输出目录>")
        sys.exit(1)
    
    extract_apis(sys.argv[1], sys.argv[2])
