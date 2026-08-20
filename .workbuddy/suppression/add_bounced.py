#!/usr/bin/env python3
"""退信自动添加器 — 发信脚本调用此脚本自动记录退信"""
import sys
import json
import os
from datetime import datetime

POOL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dead_email_pool.json')

def add_bounced(email):
    """添加退信邮箱"""
    try:
        with open(POOL_FILE, 'r', encoding='utf-8') as f:
            pool = json.load(f)
    except:
        pool = {'version': '1.0', 'updated_at': '', 'entries': []}
    
    entries = pool.get('entries', [])
    
    # 检查是否已存在
    for entry in entries:
        if isinstance(entry, dict) and entry.get('email') == email:
            return  # 已存在
        elif isinstance(entry, str) and entry == email:
            return  # 已存在
    
    entries.append({
        'email': email,
        'reason': 'bounced',
        'timestamp': datetime.now().isoformat()
    })
    pool['entries'] = entries
    pool['updated_at'] = datetime.now().isoformat()
    
    with open(POOL_FILE, 'w', encoding='utf-8') as f:
        json.dump(pool, f, ensure_ascii=False, indent=2)
    
    print(f'✅ 已记录退信: {email}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python add_bounced.py <email>')
        sys.exit(1)
    add_bounced(sys.argv[1])
