#!/usr/bin/env node
// 夜店钟楼 - 远程日志查询工具
// Usage:
//   node tools/check-logs.js              # 最近 20 条
//   node tools/check-logs.js --errors     # 只看 error
//   node tools/check-logs.js --warns      # 只看 warn
//   node tools/check-logs.js --room XXXX  # 按房间过滤
//   node tools/check-logs.js --limit 50   # 指定条数
//   node tools/check-logs.js --since 1h   # 最近 1 小时

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

async function main() {
  const args = process.argv.slice(2);
  let filters = [];
  let limit = 20;
  let order = 'created_at.desc';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--errors':
        filters.push('level=eq.error');
        break;
      case '--warns':
        filters.push('level=eq.warn');
        break;
      case '--level':
        filters.push(`level=eq.${args[++i]}`);
        break;
      case '--room':
        filters.push(`room_code=eq.${args[++i]}`);
        break;
      case '--player':
        filters.push(`player_id=eq.${args[++i]}`);
        break;
      case '--category':
        filters.push(`category=eq.${args[++i]}`);
        break;
      case '--limit':
        limit = parseInt(args[++i]) || 20;
        break;
      case '--since': {
        const val = args[++i];
        const match = val.match(/^(\d+)([hmd])$/);
        if (match) {
          const num = parseInt(match[1]);
          const unit = { h: 3600000, m: 60000, d: 86400000 }[match[2]];
          const since = new Date(Date.now() - num * unit).toISOString();
          filters.push(`created_at=gte.${since}`);
        } else {
          console.error(`Invalid --since format: ${val} (use e.g. 1h, 30m, 2d)`);
          process.exit(1);
        }
        break;
      }
      case '--help':
        console.log(`Usage: node tools/check-logs.js [options]
  --errors        Only show error level
  --warns         Only show warn level
  --level <lvl>   Filter by level (error, warn, info, event)
  --room <code>   Filter by room code
  --player <id>   Filter by player ID
  --category <c>  Filter by category (js_error, game_event, network, ui)
  --limit <n>     Number of logs (default: 20)
  --since <time>  Time window (e.g. 1h, 30m, 2d)`);
        process.exit(0);
        break;
    }
  }

  const filterStr = filters.length > 0 ? '&' + filters.join('&') : '';
  const url = `${SUPABASE_URL}/rest/v1/client_logs?select=*&order=${order}&limit=${limit}${filterStr}`;

  try {
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${await res.text()}`);
      process.exit(1);
    }

    const logs = await res.json();

    if (logs.length === 0) {
      console.log('No logs found.');
      return;
    }

    const COLORS = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[32m',
      event: '\x1b[36m',
    };
    const RESET = '\x1b[0m';
    const DIM = '\x1b[2m';

    console.log(`\n--- ${logs.length} logs ---\n`);

    for (const log of logs.reverse()) {
      const color = COLORS[log.level] || '';
      const time = log.created_at?.replace('T', ' ').split('.')[0] || '?';
      const room = log.room_code ? ` [${log.room_code}]` : '';
      const details = log.details && Object.keys(log.details).length > 0
        ? `\n    ${DIM}${JSON.stringify(log.details).substring(0, 200)}${RESET}`
        : '';

      console.log(
        `${DIM}${time}${RESET} ${color}[${log.level}]${RESET} ${log.category}: ${log.message}${room}${details}`
      );
    }

    console.log('');
  } catch (e) {
    console.error('Failed to fetch logs:', e.message);
    process.exit(1);
  }
}

main();
