// 夜店钟楼 - 远程日志模块
// 日志同时写入本地缓冲 + Supabase client_logs 表（fire-and-forget）

import { supabase } from './supabase-client.js';

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

// ============ 本地日志缓冲 ============
export const LOG_BUFFER = [];
const MAX_LOCAL = 200;

// store 引用，由 initLogger 注入
let _store = null;

/**
 * 初始化 logger，注入 store 引用
 */
export function initLogger(store) {
  _store = store;
}

/**
 * 记录日志（本地 + 远程）
 * @param {'error'|'warn'|'info'|'event'} level
 * @param {'js_error'|'game_event'|'network'|'ui'} category
 * @param {string} message
 * @param {object} details
 */
export function clientLog(level, category, message, details = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    category,
    message,
    details,
    roomCode: _store?.state?.roomCode || null,
    playerId: _store?.state?.myPlayerId || null,
  };

  // 本地缓存（环形缓冲）
  LOG_BUFFER.push(entry);
  if (LOG_BUFFER.length > MAX_LOCAL) LOG_BUFFER.shift();

  // 远程上报（fire-and-forget，不阻塞游戏流程）
  try {
    fetch(`${SUPABASE_URL}/rest/v1/client_logs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        room_code: entry.roomCode,
        player_id: entry.playerId,
        level,
        category,
        message,
        details,
        user_agent: navigator.userAgent,
      }),
    }).catch(() => {}); // 静默失败
  } catch (e) {
    // 静默失败，不影响游戏
  }

  // 同时输出到浏览器 console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${level}] ${category}: ${message}`, details);
}
