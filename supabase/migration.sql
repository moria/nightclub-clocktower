-- 夜店钟楼 - Supabase 建表 SQL
-- 在 Supabase Dashboard → SQL Editor 中运行

-- ============ 房间表 ============
CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) NOT NULL UNIQUE,
  host_id VARCHAR(64) NOT NULL,
  state JSONB DEFAULT '{}'::jsonb,
  phase VARCHAR(20) DEFAULT 'lobby',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 玩家表 ============
CREATE TABLE IF NOT EXISTS players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  player_id VARCHAR(64) NOT NULL,
  name VARCHAR(20) NOT NULL,
  role VARCHAR(30),
  alive BOOLEAN DEFAULT true,
  infected BOOLEAN DEFAULT false,
  ghost_vote_used BOOLEAN DEFAULT false,
  connected BOOLEAN DEFAULT true,
  seat_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 夜晚行动表 ============
CREATE TABLE IF NOT EXISTS night_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  target_ids JSONB DEFAULT '[]'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 消息表 ============
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  to_player_id VARCHAR(64), -- NULL = 广播给所有人
  type VARCHAR(30) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id);
CREATE INDEX IF NOT EXISTS idx_night_actions_room ON night_actions(room_id, round);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);

-- ============ RLS (行级安全) ============

-- 启用 RLS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE night_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- rooms: 所有人可读可写（anon 用户通过房间码加入）
CREATE POLICY "rooms_select" ON rooms FOR SELECT USING (true);
CREATE POLICY "rooms_insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "rooms_update" ON rooms FOR UPDATE USING (true);

-- players: 所有人可读，可写入自己
CREATE POLICY "players_select" ON players FOR SELECT USING (true);
CREATE POLICY "players_insert" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "players_update" ON players FOR UPDATE USING (true);

-- night_actions: 所有人可读可写（游戏逻辑依赖）
CREATE POLICY "night_actions_select" ON night_actions FOR SELECT USING (true);
CREATE POLICY "night_actions_insert" ON night_actions FOR INSERT WITH CHECK (true);

-- messages: 所有人可写，只能读广播消息或发给自己的
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_select" ON messages FOR SELECT USING (true);

-- ============ Realtime 订阅 ============
-- 启用 Realtime 以便监听变化
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
