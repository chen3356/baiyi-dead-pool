#!/usr/bin/env node
'use strict';
/**
 * 大奔外贸SOP · 全局垃圾邮箱池 (dead / suppression pool)
 * ---------------------------------------------------------
 * 所有被判定「预演不发」的邮箱 + 退信邮箱 统一收口，发信/验证前先查它，
 * 命中即跳过，避免浪费验证额度、损伤发信域名信誉(铁律11 同源)。
 *
 * 设计：
 *  - email 级 entries[]：单邮箱封禁（最常用）
 *  - domain 级 domain_blocks[]：整域名封禁（如确认污染域名 hyatt.com）
 *  - 跨项目共用，canonical 存于 ~/.workbuddy/suppression/
 *  - P3 找联系过滤出的死邮箱 → addDead 入池；P4 发信前 isDead 跳过；EmailCamel 验证前 isDead 跳过
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const POOL_DIR = path.join(os.homedir(), '.workbuddy', 'suppression');
const POOL_JSON = path.join(POOL_DIR, 'dead_email_pool.json');
const POOL_CSV = path.join(POOL_DIR, 'dead_email_pool.csv');

// 注意：软退信(bounce_soft, 非对方原因：spam/限流/满箱/临时不可达/try again) 不进死池，
//       改进 retry_queue 隔天换号重发（见 retry_queue.js）。本 REASON_CODES 仅含
//       「永久不可达(对方原因)」类。bounce_soft_exhausted = 软退信用尽 RETRY_MAX 次
//       仍失败后的降级死因（由 email-dispatch 在重发用尽时调用 addDead 写入）。
const REASON_CODES = {
  precheck_no_send: '预演判定不适合/不发（公司级不合适，其联系人邮箱纳入）',
  user_excluded:    '用户手动判定不发',
  bounce_hard:      '硬退信（对方原因：地址不存在/域名无MX/永久不可达）',
  bounce_soft_exhausted: '软退信用尽3次仍失败（降级为永久死，不再重发）',
  invalid:         '验证失败（invalid/dea/format_err）',
  cross_domain:    '跨域污染（第三方搜索域名≠官网域名）',
  personal_blocked:'个人免费邮箱（公司有企业域名时按规则不发）',
  generic_dept:    '通用部门/功能邮箱（info/sales/orders/muhasebe/finans/ik…）'
};

function ensureDir() { if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true }); }

function load() {
  ensureDir();
  if (!fs.existsSync(POOL_JSON)) return { version: 1, updated_at: null, entries: [], domain_blocks: [] };
  try { return JSON.parse(fs.readFileSync(POOL_JSON, 'utf8')); }
  catch (e) { console.error('读取池失败:', e.message); process.exit(1); }
}

function save(pool) {
  ensureDir();
  pool.updated_at = new Date().toISOString();
  fs.writeFileSync(POOL_JSON, JSON.stringify(pool, null, 2));
}

function normEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }
function domainOf(e) { const m = normEmail(e).match(/@([^@]+)$/); return m ? m[1] : ''; }

function findEntry(pool, email) {
  const e = normEmail(email);
  return pool.entries.find(x => x.email === e) || null;
}

/** 查是否死邮箱：命中 email 级或 domain 级都返回原因对象，否则 null */
function isDead(pool, email) {
  const e = normEmail(email);
  const hit = findEntry(pool, e);
  if (hit) return hit;
  const d = domainOf(e);
  if (d) {
    const b = pool.domain_blocks.find(x => x.domain === d);
    if (b) return { email: e, domain: d, reason_code: 'domain_block', reason_text: b.reason_text || '域名级封禁', source: b.source || '', added_at: b.added_at, added_by: b.added_by };
  }
  return null;
}

function addDead(pool, { email, reason_code, reason_text, core, source, added_by = 'auto_filter' }) {
  const e = normEmail(email);
  if (!e || !e.includes('@')) { console.error('无效邮箱:', email); return false; }
  if (!REASON_CODES[reason_code]) { console.error('未知 reason_code:', reason_code, '可选项:', Object.keys(REASON_CODES).join(',')); return false; }
  if (findEntry(pool, e)) return false; // 去重
  pool.entries.push({
    email: e, domain: domainOf(e), core: core || '',
    reason_code, reason_text: reason_text || REASON_CODES[reason_code],
    source: source || '', added_at: new Date().toISOString(), added_by
  });
  return true;
}

function addDomainBlock(pool, { domain, reason_code = 'user_excluded', reason_text = '', source = '', added_by = 'user' }) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d) return false;
  if (pool.domain_blocks.some(b => b.domain === d)) return false;
  pool.domain_blocks.push({ domain: d, reason_code, reason_text: reason_text || '域名级封禁', source, added_at: new Date().toISOString(), added_by });
  return true;
}

function removeDead(pool, email) {
  const e = normEmail(email);
  const before = pool.entries.length;
  pool.entries = pool.entries.filter(x => x.email !== e);
  return pool.entries.length < before;
}

function filterDead(pool, emails) { return emails.filter(e => !isDead(pool, e)); }

function stats(pool) {
  const by = {};
  for (const x of pool.entries) by[x.reason_code] = (by[x.reason_code] || 0) + 1;
  return { total: pool.entries.length, by_reason: by, domain_blocks: pool.domain_blocks.length };
}

function writeCSV(pool) {
  ensureDir();
  const head = '邮箱,域名,核心名,原因代码,原因说明,来源,加入时间,加入方式\n';
  const rows = pool.entries.map(x =>
    `${x.email},${x.domain},${x.core},${x.reason_code},"${x.reason_text}",${x.source},${x.added_at},${x.added_by}`
  ).join('\n');
  fs.writeFileSync(POOL_CSV, '﻿' + head + rows + '\n');
}

// ---------- CLI ----------
function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'add') {
    const email = args[1], reason = args[2];
    const opt = { email, reason_code: reason };
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--core') opt.core = args[++i];
      else if (args[i] === '--source') opt.source = args[++i];
      else if (args[i] === '--text') opt.reason_text = args[++i];
      else if (args[i] === '--by') opt.added_by = args[++i];
    }
    const pool = load(); const ok = addDead(pool, opt); save(pool); writeCSV(pool);
    console.log(ok ? '已加入' : '已存在跳过', email);
  } else if (cmd === 'add-domain') {
    const domain = args[1]; const reason = args[2] || 'user_excluded';
    const opt = { domain, reason_code: reason };
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--text') opt.reason_text = args[++i];
      else if (args[i] === '--source') opt.source = args[++i];
    }
    const pool = load(); const ok = addDomainBlock(pool, opt); save(pool); writeCSV(pool);
    console.log(ok ? '已加入域名封禁' : '已存在跳过', domain);
  } else if (cmd === 'check') {
    const pool = load(); const r = isDead(pool, args[1]);
    console.log(r ? ('DEAD -> ' + r.reason_code + ' | ' + r.reason_text) : 'OK 可发');
  } else if (cmd === 'list') {
    const pool = load(); let rows = pool.entries;
    const ri = args.indexOf('--reason'); if (ri > -1) rows = rows.filter(x => x.reason_code === args[ri + 1]);
    if (args.includes('--csv')) { writeCSV(pool); console.log('已写', POOL_CSV); }
    console.log('总数', rows.length);
    rows.slice(0, 80).forEach(x => console.log(x.email, '|', x.reason_code, '|', x.source));
  } else if (cmd === 'filter') {
    const inf = args[1];
    const oi = args.indexOf('--out'); const out = oi > -1 ? args[oi + 1] : inf.replace(/\.csv$/, '_clean.csv');
    const raw = fs.readFileSync(inf, 'utf8');
    const lines = raw.split(/\r?\n/); const head = lines[0];
    const ci = head.split(',').findIndex(h => /邮箱|email/i.test(h));
    const pool = load(); const outLines = [head]; let removed = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i]; if (!c.trim()) continue;
      const f = c.split(',');
      if (ci >= 0 && isDead(pool, f[ci])) { removed++; continue; }
      outLines.push(c);
    }
    fs.writeFileSync(out, outLines.join('\n'));
    console.log('过滤', removed, '个死邮箱, 输出', out);
  } else if (cmd === 'remove') {
    const pool = load(); const ok = removeDead(pool, args[1]); save(pool); writeCSV(pool);
    console.log(ok ? '已移除' : '未找到', args[1]);
  } else if (cmd === 'stats') {
    const pool = load();
    console.log(JSON.stringify(stats(pool), null, 2));
  } else {
    console.log('用法:');
    console.log('  node dead_pool.js add <email> <reason_code> [--core X --source Y --text Z --by user]');
    console.log('  node dead_pool.js add-domain <domain> <reason_code> [--text Z --source Y]');
    console.log('  node dead_pool.js check <email>');
    console.log('  node dead_pool.js list [--reason R] [--csv]');
    console.log('  node dead_pool.js filter <input.csv> [--out out.csv]   # 按"邮箱"列剔除死邮箱');
    console.log('  node dead_pool.js remove <email>');
    console.log('  node dead_pool.js stats');
    console.log('reason_code:', Object.keys(REASON_CODES).join(', '));
  }
}

module.exports = { load, save, isDead, addDead, addDomainBlock, removeDead, filterDead, stats, writeCSV, REASON_CODES, POOL_JSON, POOL_CSV };
if (require.main === module) main();
