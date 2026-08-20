#!/usr/bin/env python3
"""垃圾邮箱池 Git 同步 — 柏屹档案团队成员共享"""
import json
import os
import subprocess
import sys
from datetime import datetime

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL_FILE = 'dead_email_pool.json'
POOL_PATH = os.path.join(PROJECT_DIR, '.workbuddy', 'suppression', POOL_FILE)

def load_pool():
    try:
        with open(POOL_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {'version': '1.0', 'updated_at': '', 'entries': [], 'domain_blocks': {}}

def save_pool(data):
    data['updated_at'] = datetime.now().isoformat()
    with open(POOL_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def git_pull():
    """从远程拉取最新"""
    try:
        subprocess.run(['git', 'pull'], cwd=PROJECT_DIR, check=True, capture_output=True)
        print('✅ 已拉取最新')
        return True
    except Exception as e:
        print(f'❌ 拉取失败: {e}')
        return False

def git_push(message='update dead pool'):
    """推送到远程"""
    try:
        subprocess.run(['git', 'add', POOL_PATH], cwd=PROJECT_DIR, check=True)
        subprocess.run(['git', 'commit', '-m', message], cwd=PROJECT_DIR, check=True)
        subprocess.run(['git', 'push'], cwd=PROJECT_DIR, check=True)
        print('✅ 已推送')
        return True
    except Exception as e:
        print(f'❌ 推送失败: {e}')
        return False

def add_dead_email(email, reason='bounced'):
    """添加 dead 邮箱"""
    pool = load_pool()
    entries = pool.get('entries', [])
    
    # 检查是否已存在
    for entry in entries:
        if isinstance(entry, dict) and entry.get('email') == email:
            print(f'⚠️ 已存在: {email}')
            return
        elif isinstance(entry, str) and entry == email:
            print(f'⚠️ 已存在: {email}')
            return
    
    entries.append({
        'email': email,
        'reason': reason,
        'timestamp': datetime.now().isoformat()
    })
    pool['entries'] = entries
    save_pool(pool)
    print(f'✅ 已添加: {email} (共 {len(entries)} 个)')
    
    # 自动提交
    git_push(f'add dead: {email}')

def remove_dead_email(email):
    """移除 dead 邮箱（误报恢复）"""
    pool = load_pool()
    entries = pool.get('entries', [])
    
    new_entries = []
    removed = False
    for entry in entries:
        if isinstance(entry, dict) and entry.get('email') == email:
            removed = True
            continue
        elif isinstance(entry, str) and entry == email:
            removed = True
            continue
        new_entries.append(entry)
    
    if removed:
        pool['entries'] = new_entries
        save_pool(pool)
        print(f'✅ 已移除: {email}')
        git_push(f'remove dead: {email}')
    else:
        print(f'⚠️ 未找到: {email}')

def show_stats():
    """显示统计"""
    pool = load_pool()
    entries = pool.get('entries', [])
    print(f'📊 垃圾邮箱池: {len(entries)} 个地址')
    print(f'   更新时间: {pool.get("updated_at", "unknown")}')
    
    # 按原因统计
    from collections import Counter
    reasons = Counter()
    for entry in entries:
        if isinstance(entry, dict):
            reasons[entry.get('reason', 'unknown')] += 1
        else:
            reasons['unknown'] += 1
    
    if reasons:
        print('\n📈 按原因:')
        for reason, count in reasons.most_common():
            print(f'   {reason}: {count}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法:')
        print('  python sync_dead_pool.py pull              # 拉取最新')
        print('  python sync_dead_pool.py add <email>       # 添加退信')
        print('  python sync_dead_pool.py remove <email>    # 移除误报')
        print('  python sync_dead_pool.py stats             # 查看统计')
        sys.exit(1)
    
    cmd = sys.argv[1]
    if cmd == 'pull':
        git_pull()
    elif cmd == 'add' and len(sys.argv) > 2:
        add_dead_email(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'bounced')
    elif cmd == 'remove' and len(sys.argv) > 2:
        remove_dead_email(sys.argv[2])
    elif cmd == 'stats':
        show_stats()
    else:
        print('未知命令')
