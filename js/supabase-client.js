// 夜店钟楼 - Supabase 实时通信客户端
// TODO: 填入你的 Supabase 项目凭证

const SUPABASE_URL = 'https://nxeybszulisostkazlkc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54ZXlic3p1bGlzb3N0a2F6bGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDA3NTMsImV4cCI6MjA5MTYxNjc1M30.xGtEfSMKvglwXYZg4mOR_pyIMpjAFQSxUUR6h01P5Xo';

// ============ Supabase 轻量客户端 ============
// 不依赖 SDK，直接用 fetch + WebSocket 实现

class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.realtimeUrl = url.replace('https://', 'wss://') + '/realtime/v1/websocket';
    this.ws = null;
    this.channels = new Map();
    this.ref = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.listeners = new Map();
  }

  // ============ REST API ============

  async _fetch(path, options = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
        ...options.headers,
      },
      ...options,
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ============ 房间管理 ============

  /** 创建房间 */
  async createRoom(hostName) {
    const code = this._generateCode();
    const hostId = this._generateId();

    const [room] = await this._fetch('rooms', {
      method: 'POST',
      body: JSON.stringify({
        code,
        host_id: hostId,
        state: {},
        phase: 'lobby',
      }),
    });

    // 房主加入为第一个玩家
    const [player] = await this._fetch('players', {
      method: 'POST',
      body: JSON.stringify({
        room_id: room.id,
        name: hostName,
        player_id: hostId,
        role: null,
        alive: true,
        infected: false,
        ghost_vote_used: false,
        connected: true,
        seat_index: 0,
      }),
    });

    return { room, player, hostId, code };
  }

  /** 加入房间 */
  async joinRoom(code, playerName) {
    const rooms = await this._fetch(`rooms?code=eq.${code}&select=*`);
    if (rooms.length === 0) throw new Error('房间不存在');

    const room = rooms[0];
    const playerId = this._generateId();

    // 获取当前玩家数作为座位号
    const existingPlayers = await this._fetch(`players?room_id=eq.${room.id}&select=*`);

    const [player] = await this._fetch('players', {
      method: 'POST',
      body: JSON.stringify({
        room_id: room.id,
        name: playerName,
        player_id: playerId,
        role: null,
        alive: true,
        infected: false,
        ghost_vote_used: false,
        connected: true,
        seat_index: existingPlayers.length,
      }),
    });

    return { room, player, playerId };
  }

  /** 获取房间玩家列表 */
  async getPlayers(roomId) {
    return this._fetch(`players?room_id=eq.${roomId}&select=*&order=seat_index`);
  }

  /** 更新玩家角色 */
  async updatePlayerRole(playerId, roleId) {
    return this._fetch(`players?player_id=eq.${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: roleId }),
    });
  }

  /** 更新房间阶段 */
  async updateRoomPhase(roomId, phase, state = {}) {
    return this._fetch(`rooms?id=eq.${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify({ phase, state }),
    });
  }

  // ============ 消息系统 ============

  /** 发送消息（广播或私密） */
  async sendMessage(roomId, type, payload, toPlayerId = null) {
    return this._fetch('messages', {
      method: 'POST',
      body: JSON.stringify({
        room_id: roomId,
        to_player_id: toPlayerId,
        type,
        payload,
      }),
    });
  }

  /** 获取我的消息 */
  async getMyMessages(roomId, playerId) {
    return this._fetch(
      `messages?room_id=eq.${roomId}&or=(to_player_id.is.null,to_player_id.eq.${playerId})&select=*&order=created_at`
    );
  }

  // ============ Realtime (WebSocket) ============

  /** 连接 WebSocket */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(`${this.realtimeUrl}?apikey=${this.key}&vsn=1.0.0`);

    this.ws.onopen = () => {
      console.log('[Supabase] WebSocket connected');
      this._startHeartbeat();
      // 重新订阅所有 channel
      this.channels.forEach((handlers, topic) => {
        this._sendJoin(topic);
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch (e) {
        console.error('[Supabase] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[Supabase] WebSocket closed, reconnecting...');
      this._stopHeartbeat();
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (err) => {
      console.error('[Supabase] WebSocket error:', err);
    };
  }

  /** 订阅房间 channel */
  subscribeRoom(roomCode, handlers = {}) {
    const topic = `realtime:room:${roomCode}`;
    this.channels.set(topic, handlers);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendJoin(topic);
    }

    return () => {
      this.channels.delete(topic);
      this._sendLeave(topic);
    };
  }

  /** 广播事件到房间 */
  broadcastToRoom(roomCode, event, payload) {
    const topic = `realtime:room:${roomCode}`;
    this._send({
      topic,
      event: 'broadcast',
      payload: { type: 'broadcast', event, payload },
      ref: String(++this.ref),
    });
  }

  /** 断开连接 */
  disconnect() {
    this._stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ============ 内部方法 ============

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _sendJoin(topic) {
    this._send({
      topic,
      event: 'phx_join',
      payload: { config: { broadcast: { self: true } } },
      ref: String(++this.ref),
    });
  }

  _sendLeave(topic) {
    this._send({
      topic,
      event: 'phx_leave',
      payload: {},
      ref: String(++this.ref),
    });
  }

  _handleMessage(msg) {
    if (msg.event === 'broadcast') {
      const handlers = this.channels.get(msg.topic);
      if (handlers) {
        const { event, payload } = msg.payload;
        if (handlers[event]) {
          handlers[event](payload);
        }
        if (handlers['*']) {
          handlers['*'](event, payload);
        }
      }
    }
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this._send({
        topic: 'phoenix',
        event: 'heartbeat',
        payload: {},
        ref: String(++this.ref),
      });
    }, 30000);
  }

  _stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
  }

  _generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  _generateId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}

// ============ 单例导出 ============

export const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 初始化 Supabase 连接
 * @param {string} url - Supabase project URL
 * @param {string} key - Supabase anon key
 */
export function initSupabase(url, key) {
  supabase.url = url;
  supabase.key = key;
  supabase.realtimeUrl = url.replace('https://', 'wss://') + '/realtime/v1/websocket';
}
