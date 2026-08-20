#!/usr/bin/env python3
"""同步垃圾邮箱池 — 项目级 ↔ 用户级"""
import json
import os
from datetime import datetime

PROJECT_POOL = os.path.join(os.path.dirname(__file__), 'dead_email_pool.json')
USER_POOL = os.path.expanduser('~/.workbuddy/suppression/dead_email_pool.json')

def load_pool(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {'version': '1.0', 'updated_at': '', 'entries': [], 'domain_blocks': {}}

def save_pool(path, data):
    data['updated_at'] = datetime.now().isoformat()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def sync_pools():
    """双向同步：合并两个池子的 entries"""
    project = load_pool(PROJECT_POOL)
    user = load_pool(USER_POOL)
    
    # 合并 entries
    project_entries = project.get('entries', [])
    user_entries = user.get('entries', [])
    
    # 用 email 去重
    seen = set()
    merged = []
    for entry in project_entries + user_entries:
        email = entry.get('email', entry) if isinstance(entry, dict) else entry
        if isinstance(entry, str):
            entry = {'email': email, 'reason': 'unknown', 'timestamp': ''}
        if email not in seen:
            seen.add(email)
            merged.append(entry)
    
    # 更新两个池子
    project['entries'] = merged
    user['entries'] = merged
    
    save_pool(PROJECT_POOL, project)
    save_pool(USER_POOL, user)
    
    print(f'✅ 同步完成: {len(merged)} 个邮箱')
    print(f'   项目池: {PROJECT_POOL}')
    print(f'   用户池: {USER_POOL}')

def add_dead_email(email, reason='bounced'):
    """添加 dead 邮箱到两个池子"""
    for path in [PROJECT_POOL, USER_POOL]:
        pool = load_pool(path)
        entries = pool.get('entries', [])
        
        # 检查是否已存在
        exists = False
        for entry in entries:
            if isinstance(entry, dict) and entry.get('email') == email:
                exists = True
                break
            elif isinstance(entry, str) and entry == email:
                exists = True
                break
        
        if not exists:
            entries.append({
                'email': email,
                'reason': reason,
                'timestamp': datetime.now().isoformat()
            })
            pool['entries'] = entries
            save_pool(path, pool)
            print(f'✅ 已添加: {email}')

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'sync':
        sync_pools()
    elif len(sys.argv) > 2 and sys.argv[1] == 'add':
        add_dead_email(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'bounced')
    else:
        print('用法:')
        print('  python sync_pool.py sync          # 双向同步')
        print('  python sync_pool.py add <email>   # 添加 dead 邮箱')
