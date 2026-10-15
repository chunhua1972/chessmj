import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEFAULT_RULE_SET, faceLabel, type ClaimAction, type KongOption, type Tile } from '../domain/game-engine';
import { supabase } from '../lib/supabase';

type Room = { id: string; room_code: string; host_user_id: string; seat_count: number; status: string; rules_hash: string };
type Member = { room_id: string; seat: number; user_id: string | null; controller: 'human' | 'ai'; display_name: string; ready: boolean };
type OnlineState = {
  matchId: string; roomId: string; version: number; mySeat: number; phase: string; turnSeat: number;
  turnNumber: number; dealerSeat: number; wallCount: number; hand: Tile[];
  ownKongs: KongOption[];
  claim: null | { fromSeat: number; tile: Tile; deadlineAt: string; responded: boolean; choices: null | { winning: boolean; pong: boolean; openKong: boolean; chiOptions: Array<{ faces: string[]; tileIds: string[] }> } };
  players: Array<{ seat: number; name: string; controller: string; handCount: number; discards: Tile[]; melds: unknown[]; score: number }>;
  result: { winnerSeat: number | null; source?: string } | null;
};

function TileButton({ tile, disabled, onClick }: { tile: Tile; disabled: boolean; onClick: () => void }) {
  const red = tile.face.startsWith('red:');
  return <button type="button" className={`piece-tile online-tile ${red ? 'red' : 'black'}`} disabled={disabled} onClick={onClick} aria-label={`打出${red ? '紅' : '黑'}色${faceLabel(tile.face)}`}>{faceLabel(tile.face)}</button>;
}

function prettyError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '操作失敗，請稍後重試。';
}

export default function OnlineLobby({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('棋友');
  const [roomCode, setRoomCode] = useState('');
  const [seatCount, setSeatCount] = useState(4);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [match, setMatch] = useState<OnlineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('使用電子郵件登入後即可建立或加入房間。');

  const loadRoom = useCallback(async (id: string) => {
    if (!supabase) return;
    const [{ data: roomData, error: roomError }, { data: memberData, error: memberError }] = await Promise.all([
      supabase.from('chessmj_rooms').select('*').eq('id', id).maybeSingle(),
      supabase.from('chessmj_room_members').select('*').eq('room_id', id).order('seat'),
    ]);
    if (roomError || memberError) { setMessage(roomError?.message ?? memberError?.message ?? '無法載入房間。'); return; }
    if (!roomData) {
      setRoom(null); setMembers([]); setRoomId(null); setMatch(null); sessionStorage.removeItem('chessmj-room-id');
      return;
    }
    setRoom(roomData as Room);
    setMembers((memberData ?? []) as Member[]);
  }, []);

  const loadMatch = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke('chessmj-match', { body: { action: 'resume', roomId: id } });
    if (error) { setMessage(prettyError(error)); return; }
    if (data?.state) setMatch(data.state as OnlineState);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      const savedRoom = sessionStorage.getItem('chessmj-room-id');
      if (data.session && savedRoom) {
        setRoomId(savedRoom);
        void loadRoom(savedRoom);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setRoom(null); setMembers([]); setMatch(null); setRoomId(null); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [loadMatch, loadRoom]);

  useEffect(() => {
    if ((room?.status === 'playing' || room?.status === 'ended') && room.id && !match) void loadMatch(room.id);
  }, [loadMatch, match, room?.id, room?.status]);

  useEffect(() => {
    const client = supabase;
    if (!client || !roomId || !session) return;
    const channel = client.channel(`chessmj-room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chessmj_room_members', filter: `room_id=eq.${roomId}` }, () => {
        void loadRoom(roomId);
        if (room?.status === 'playing') void loadMatch(roomId);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadMatch, loadRoom, room?.status, roomId, session]);

  useEffect(() => {
    const client = supabase;
    if (!client || !match || !session) return;
    const channel = client.channel(`chessmj-match-${match.matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chessmj_match_events', filter: `match_id=eq.${match.matchId}` }, () => {
        if (match.roomId) void loadMatch(match.roomId);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadMatch, match?.matchId, match?.roomId, session]);

  async function runBusy(operation: () => Promise<void>) {
    setBusy(true);
    try { await operation(); } catch (error) { setMessage(prettyError(error)); }
    finally { setBusy(false); }
  }

  async function sendMagicLink() {
    await runBusy(async () => {
      if (!supabase) throw new Error('尚未設定 Supabase 連線，請依 .env.example 設定公開網址與 anon key。');
      const client = supabase;
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setMessage('登入連結已寄出，請開啟電子郵件完成登入。');
    });
  }

  async function signOut() {
    if (!supabase) return;
    const client = supabase;
    await runBusy(async () => {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      sessionStorage.removeItem('chessmj-room-id');
      setMessage('已登出。');
    });
  }

  function rememberRoom(id: string) {
    sessionStorage.setItem('chessmj-room-id', id);
    setRoomId(id);
    setMatch(null);
  }

  async function createRoom() {
    await runBusy(async () => {
      if (!supabase) throw new Error('Supabase 尚未設定。');
      const client = supabase;
      const { data, error } = await client.rpc('chessmj_create_room', {
        p_seat_count: seatCount, p_rules: { ...DEFAULT_RULE_SET, seatCount },
        p_rules_hash: `${DEFAULT_RULE_SET.rulesHash}:seats-${seatCount}`, p_display_name: displayName,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.room_id) throw new Error('房間建立失敗。');
      rememberRoom(row.room_id);
      await loadRoom(row.room_id);
      setMessage(`房間已建立，邀請朋友輸入房間碼 ${row.room_code}。`);
    });
  }

  async function joinRoom() {
    await runBusy(async () => {
      if (!supabase) throw new Error('Supabase 尚未設定。');
      const client = supabase;
      const { data, error } = await client.rpc('chessmj_join_room', { p_room_code: roomCode.trim(), p_display_name: displayName });
      if (error) {
        const resumed = await client.functions.invoke('chessmj-match', { body: { action: 'resume_code', roomCode: roomCode.trim() } });
        if (resumed.error || !resumed.data?.roomId) throw error;
        rememberRoom(resumed.data.roomId);
        await loadRoom(resumed.data.roomId);
        if (resumed.data.state) setMatch(resumed.data.state as OnlineState);
        setMessage('已重新連線至你的房間。');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.room_id) throw new Error('找不到可加入的房間。');
      rememberRoom(row.room_id);
      await loadRoom(row.room_id);
      setMessage(`已加入房間 ${row.room_code}。`);
    });
  }

  async function updateReady(ready: boolean) {
    if (!supabase || !roomId) return;
    const client = supabase;
    await runBusy(async () => {
      const { error } = await client.rpc('chessmj_set_ready', { p_room_id: roomId, p_ready: ready });
      if (error) throw error;
      await loadRoom(roomId);
    });
  }

  async function fillAi() {
    if (!supabase || !roomId) return;
    const client = supabase;
    await runBusy(async () => {
      const { error } = await client.rpc('chessmj_fill_ai', { p_room_id: roomId });
      if (error) throw error;
      await loadRoom(roomId);
      setMessage('已用電腦補滿空位。');
    });
  }

  async function leaveRoom() {
    if (!supabase || !roomId) return;
    const client = supabase;
    await runBusy(async () => {
      const { error } = await client.rpc('chessmj_leave_room', { p_room_id: roomId });
      if (error) throw error;
      sessionStorage.removeItem('chessmj-room-id');
      setRoom(null); setMembers([]); setMatch(null); setRoomId(null);
      setMessage('已離開房間。');
    });
  }

  async function startMatch() {
    if (!supabase || !roomId) return;
    const client = supabase;
    await runBusy(async () => {
      const { data, error } = await client.functions.invoke('chessmj-match', { body: { action: 'start', roomId } });
      if (error) throw error;
      await loadMatch(roomId);
      setMessage(data?.matchId ? '牌局開始，資料由 Supabase 同步。' : '牌局已開始。');
      await loadRoom(roomId);
    });
  }

  async function doAction(action: 'draw' | 'discard' | 'self_draw' | 'claim' | 'resolve_claims' | 'declare_kong', extra: Record<string, unknown> = {}) {
    if (!supabase || !match) return;
    const client = supabase;
    await runBusy(async () => {
      const { data, error } = await client.functions.invoke('chessmj-match', {
        body: { action, matchId: match.matchId, expectedVersion: match.version, requestId: crypto.randomUUID(), ...extra },
      });
      if (error) {
        const details = await error.context?.json?.().catch(() => null);
        throw new Error(details?.error ?? prettyError(error));
      }
      if (data?.state) setMatch(data.state as OnlineState);
      setMessage(data?.status === 'ended' ? '本局已結束。' : '牌局已同步。');
    });
  }

  useEffect(() => {
    const client = supabase;
    if (!client || !match?.claim) return;
    const delay = Math.max(0, Date.parse(match.claim.deadlineAt) - Date.now());
    const timer = window.setTimeout(() => {
      void client.functions.invoke('chessmj-match', {
        body: { action: 'resolve_claims', matchId: match.matchId, expectedVersion: match.version, requestId: crypto.randomUUID() },
      }).then(({ data }) => {
        if (data?.state) setMatch(data.state as OnlineState);
        else if (roomId) void loadMatch(roomId);
      });
    }, delay + 20);
    return () => window.clearTimeout(timer);
  }, [loadMatch, match?.claim?.deadlineAt, match?.matchId, match?.roomId, match?.version, roomId]);

  const myMember = members.find((member) => member.user_id === session?.user.id);
  const isHost = Boolean(room && session && room.host_user_id === session.user.id);
  const canDraw = Boolean(match && match.phase === 'draw' && match.turnSeat === match.mySeat);
  const canDiscard = Boolean(match && (match.phase === 'initial-discard' || match.phase === 'discard') && match.turnSeat === match.mySeat);
  const canSelfDraw = Boolean(match && match.phase === 'discard' && match.turnSeat === match.mySeat);

  return <section className="content-page online-page">
    <button className="back-link" onClick={onBack}>‹ 回首頁</button>
    <div className="page-eyebrow">PLAY TOGETHER</div>
    <h1>好友同桌。</h1>
    <p className="page-lead">以電子郵件登入，建立房間碼邀請朋友，或加入熟人的牌桌。</p>

    {!supabase && <div className="online-notice">尚未設定 Supabase。請將 `.env.example` 複製為 `.env.local`，填入專案網址和公開 anon key，再重新啟動網站。</div>}
    {message && <div className="online-status" role="status">{message}</div>}

    {!session ? <div className="online-panel auth-panel">
      <div><span className="section-kicker">SUPABASE AUTH</span><h2>電子郵件登入</h2><p>我們會寄一封一次性登入連結，不需要設定密碼。</p></div>
      <label className="online-field"><span>電子郵件</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <button className="primary-button" disabled={busy || !email.trim() || !supabase} onClick={() => void sendMagicLink()}><span>{busy ? '處理中…' : '寄送登入連結'}</span></button>
    </div> : <>
      {!match && !room && <div className="online-panel lobby-entry">
        <div className="online-account"><div><span className="section-kicker">SIGNED IN</span><b>{session.user.email}</b></div><button className="quiet-button" disabled={busy} onClick={() => void signOut()}>登出</button></div>
        <label className="online-field"><span>桌上顯示名稱</span><input maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <div className="online-entry-grid">
          <div className="online-action-card"><span className="mode-icon amber-icon"><span>友</span></span><h2>建立房間</h2><p>選擇座位數，建好後把房間碼傳給朋友。</p><label className="online-field"><span>座位數</span><select value={seatCount} onChange={(event) => setSeatCount(Number(event.target.value))}>{[2, 3, 4].map((count) => <option key={count} value={count}>{count} 位玩家</option>)}</select></label><button className="primary-button" disabled={busy || !supabase} onClick={() => void createRoom()}><span>建立新房間</span></button></div>
          <div className="online-action-card"><span className="mode-icon blue-icon"><span>碼</span></span><h2>加入朋友房間</h2><p>輸入朋友分享的 8 位房間碼。</p><label className="online-field"><span>房間碼</span><input maxLength={8} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="例如 A1B2C3D4" /></label><button className="primary-button" disabled={busy || roomCode.trim().length < 8 || !supabase} onClick={() => void joinRoom()}><span>加入房間</span></button></div>
        </div>
      </div>}

      {room && !match && <div className="online-panel room-panel">
        <div className="room-code-heading"><div><span className="section-kicker">ROOM CODE</span><b>{room.room_code}</b></div><span className="room-state">{room.status === 'playing' ? '牌局進行中' : '等待玩家'}</span></div>
        <p>分享此房間碼，朋友登入後即可加入。座位 {members.length} / {room.seat_count}</p>
        <div className="online-seat-grid">{Array.from({ length: room.seat_count }, (_, seat) => {
          const member = members.find((item) => item.seat === seat);
          return <div className={`online-seat ${member?.ready ? 'ready' : ''}`} key={seat}><span className="seat-index">{seat + 1}</span><div><b>{member?.display_name ?? '等待加入'}</b><small>{member ? member.controller === 'ai' ? '電腦 · 已準備' : member.user_id === room.host_user_id ? '房主' : member.ready ? '已準備' : '尚未準備' : '空位'}</small></div><span>{member?.ready ? '✓' : '·'}</span></div>;
        })}</div>
        <div className="online-actions">
          {myMember && <button className="quiet-button" disabled={busy} onClick={() => void updateReady(!myMember.ready)}>{myMember.ready ? '取消準備' : '準備完成'}</button>}
          {isHost && <button className="quiet-button" disabled={busy || room.status !== 'waiting'} onClick={() => void fillAi()}>電腦補滿</button>}
          {isHost && <button className="primary-button" disabled={busy || room.status !== 'waiting' || members.length !== room.seat_count || members.some((member) => !member.ready)} onClick={() => void startMatch()}><span>開始牌局</span></button>}
          {room.status === 'playing' && <button className="primary-button" disabled={busy} onClick={() => void loadMatch(room.id)}><span>回到牌局</span></button>}
          {room.status === 'waiting' && <button className="quiet-button" disabled={busy} onClick={() => void leaveRoom()}>離開房間</button>}
        </div>
      </div>}

      {match && <div className="online-panel match-panel">
        <div className="room-code-heading"><div><span className="section-kicker">ONLINE MATCH</span><b>{match.result ? '本局結束' : `第 ${match.turnNumber + 1} 巡`}</b></div><span className="room-state">牌牆 {match.wallCount} · 同步版本 {match.version}</span></div>
        <div className="online-opponents">{match.players.map((player) => <div className={`online-opponent ${player.seat === match.turnSeat ? 'active' : ''}`} key={player.seat}><span>座位 {player.seat + 1}</span><b>{player.seat === match.mySeat ? '你' : player.name}</b><small>{player.handCount} 枚 · 棄牌 {player.discards.map((tile) => faceLabel(tile.face)).join(' ') || '—'}</small></div>)}</div>
        <div className="online-turn-message">{match.result ? match.result.winnerSeat === null ? '流局' : `座位 ${match.result.winnerSeat + 1} 胡牌` : match.claim ? match.claim.responded ? '已送出回應，等待其他玩家' : '有人打出棋子，請選擇回應' : match.turnSeat === match.mySeat ? canDraw ? '輪到你摸牌' : canDiscard ? '選一枚棋子打出' : '輪到你行動' : `等待 ${match.players[match.turnSeat]?.name ?? '玩家'} 行動`}</div>
        <div className="online-hand" aria-label="你的線上手牌">{match.hand.map((tile) => <TileButton key={tile.id} tile={tile} disabled={!canDiscard || busy} onClick={() => void doAction('discard', { tileId: tile.id })} />)}</div>
        <div className="online-actions">
          {canDraw && <button className="primary-button" disabled={busy} onClick={() => void doAction('draw')}><span>摸一枚</span></button>}
          {canSelfDraw && <button className="quiet-button" disabled={busy} onClick={() => void doAction('self_draw')}>自摸胡牌</button>}
          {match.claim?.choices && !match.claim.responded && <>
            {match.claim.choices.winning && <button className="primary-button" disabled={busy} onClick={() => void doAction('claim', { claimAction: 'win' satisfies ClaimAction })}><span>胡牌</span></button>}
            {match.claim.choices.pong && <button className="quiet-button" disabled={busy} onClick={() => void doAction('claim', { claimAction: 'pong' satisfies ClaimAction })}>碰</button>}
            {match.claim.choices.openKong && <button className="quiet-button" disabled={busy} onClick={() => void doAction('claim', { claimAction: 'kong' satisfies ClaimAction })}>槓</button>}
            {match.claim.choices.chiOptions.map((option, index) => <button className="quiet-button" disabled={busy} key={index} onClick={() => void doAction('claim', { claimAction: 'chi' satisfies ClaimAction, chiTileIds: option.tileIds })}>吃</button>)}
            <button className="quiet-button" disabled={busy} onClick={() => void doAction('claim', { claimAction: 'pass' satisfies ClaimAction })}>過牌</button>
          </>}
          {canDiscard && match.ownKongs.map((option) => <button className="quiet-button" key={`${option.kind}-${option.face}`} disabled={busy} onClick={() => void doAction('declare_kong', { kongOption: option })}>{option.kind === 'concealed' ? '暗槓' : '加槓'}</button>)}
          {roomId && <button className="quiet-button" disabled={busy} onClick={() => void loadMatch(roomId)}>重新同步</button>}
          <button className="quiet-button" onClick={onBack}>回首頁</button>
        </div>
      </div>}
    </>}
  </section>;
}
