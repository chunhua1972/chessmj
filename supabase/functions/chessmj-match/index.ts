import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applySettlement, canKong, canPong, createGame, DEFAULT_RULE_SET, declareSelfDraw, discardTile,
  drawTile, evaluateScore, getChiOptions, isWinningHand, resolveClaimResponses, sortTiles,
  type ClaimAction, type ClaimResponse, type GameState, type KongOption, type Meld, type RuleSet, type SeatId, type Tile,
} from '../../../src/domain/game-engine/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RequestBody = {
  action?: 'start' | 'resume' | 'state' | 'resume_code' | 'draw' | 'discard' | 'self_draw' | 'claim' | 'resolve_claims' | 'declare_kong';
  claimAction?: ClaimAction;
  chiTileIds?: string[];
  kongOption?: KongOption;
  roomId?: string;
  roomCode?: string;
  matchId?: string;
  expectedVersion?: number;
  requestId?: string;
  tileId?: string;
};

type PendingClaim = {
  tile: Tile;
  fromSeat: SeatId;
  eligibleSeats: SeatId[];
  responses: Record<number, ClaimResponse>;
  deadlineAt: string;
};
type OnlineGameState = GameState & { phase: GameState['phase'] | 'claim'; pendingClaim?: PendingClaim };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? '';
  const known = [
    'room_not_full', 'all_seats_must_be_ready', 'waiting_room_required', 'active_match_not_found',
    'stale_match_version', 'wrong-phase', 'not-your-turn', 'tile-not-in-hand', 'not-winning',
    'empty-wall', 'room_membership_required', 'host_required', 'room_has_no_match',
  ];
  return known.find((code) => message.includes(code)) ?? fallback;
}

function claimChoices(state: OnlineGameState, seat: number) {
  const pending = state.pendingClaim;
  if (state.phase !== 'claim' || !pending || seat === pending.fromSeat) return null;
  const player = state.players[seat];
  const winning = isWinningHand([...player.hand, pending.tile], player.melds, state.ruleSet);
  const pong = canPong(player.hand, pending.tile, state.ruleSet);
  const openKong = canKong(state, seat as SeatId, pending.tile).some((option) => option.kind === 'open');
  const nextSeat = (pending.fromSeat + 1) % state.players.length;
  const chiOptions = seat === nextSeat ? getChiOptions(player.hand, pending.tile, state.ruleSet).map((faces) => ({
    faces, tileIds: faces.map((face) => player.hand.find((tile) => tile.face === face)?.id).filter((id): id is string => Boolean(id)),
  })) : [];
  return { winning, pong, openKong, chiOptions };
}

function beginDiscardClaims(input: GameState, fromSeat: SeatId): OnlineGameState {
  const state = input as OnlineGameState;
  const tile = state.players[fromSeat].discards.at(-1);
  if (!tile) return state;
  const eligibleSeats = state.players.flatMap((player) => player.seat === fromSeat ? [] :
    Object.values(claimChoices({ ...state, phase: 'claim', pendingClaim: { tile, fromSeat, eligibleSeats: [], responses: {}, deadlineAt: '' } }, player.seat) ?? {}).some((value) => Array.isArray(value) ? value.length > 0 : value)
      ? [player.seat] : []);
  if (!eligibleSeats.length) return { ...state, phase: 'draw', turnSeat: ((fromSeat + 1) % state.players.length) as SeatId, pendingClaim: undefined };
  return {
    ...state,
    phase: 'claim',
    turnSeat: fromSeat,
    pendingClaim: {
      tile, fromSeat, eligibleSeats, responses: {},
      deadlineAt: new Date(Date.now() + (state.ruleSet.claimTimeoutMs || 8_000)).toISOString(),
    },
  };
}

function finalizeClaim(stateInput: OnlineGameState, responseInput: ClaimResponse): OnlineGameState {
  const pending = stateInput.pendingClaim;
  if (!pending) return stateInput;
  const state = { ...stateInput } as OnlineGameState;
  const seat = responseInput.seat;
  const claimant = state.players[seat];
  const source = state.players[pending.fromSeat];
  if (responseInput.action === 'win') {
    const winningState: OnlineGameState = {
      ...state, phase: 'ended', pendingClaim: undefined,
      players: state.players.map((player) => player.seat === seat ? { ...player, hand: sortTiles([...player.hand, pending.tile]) } : player),
      result: { winnerSeat: seat, source: 'discard', reason: 'win' },
    };
    const settled = applySettlement(winningState, evaluateScore(winningState, seat, 'discard'), seat, false, pending.fromSeat);
    return { ...settled, phase: 'ended', pendingClaim: undefined };
  }
  const removeFromSource = (players: GameState['players']) => players.map((player) => player.seat === pending.fromSeat
    ? { ...player, discards: player.discards.filter((tile) => tile.id !== pending.tile.id) } : player);
  const handIds = responseInput.action === 'pong' ? claimant.hand.filter((tile) => tile.face === pending.tile.face).slice(0, 2).map((tile) => tile.id)
    : responseInput.action === 'kong' ? claimant.hand.filter((tile) => tile.face === pending.tile.face).slice(0, 3).map((tile) => tile.id)
      : responseInput.action === 'chi' ? (responseInput.chiFaces ?? []).map((face) => claimant.hand.find((tile) => tile.face === face)?.id).filter((id): id is string => Boolean(id)) : [];
  const removeIds = new Set(handIds);
  const tileFaces = handIds.map((id) => claimant.hand.find((tile) => tile.id === id)!.face);
  const kind = responseInput.action === 'pong' ? 'triplet' : responseInput.action === 'kong' ? 'kong' : 'sequence';
  const meld: Meld = {
    id: crypto.randomUUID(), kind, faces: [...tileFaces, pending.tile.face], tileIds: [...handIds, pending.tile.id],
    source: 'discard', fromSeat: pending.fromSeat,
  };
  const updatedPlayers = removeFromSource(state.players).map((player) => player.seat === seat ? {
    ...player,
    hand: player.hand.filter((tile) => !removeIds.has(tile.id)),
    melds: [...player.melds, meld],
  } : player);
  const nextPhase = responseInput.action === 'kong' ? 'draw' : 'discard';
  return {
    ...state, players: updatedPlayers, phase: nextPhase, turnSeat: seat,
    turnNumber: state.turnNumber + 1, eventSeq: state.eventSeq + 1, pendingClaim: undefined,
  };
}

function submitClaim(stateInput: OnlineGameState, responseInput: ClaimResponse, chiTileIds: string[] = []): OnlineGameState | null {
  const pending = stateInput.pendingClaim;
  if (stateInput.phase !== 'claim' || !pending || !pending.eligibleSeats.includes(responseInput.seat)) return null;
  const choices = claimChoices(stateInput, responseInput.seat);
  if (!choices) return null;
  let normalized = responseInput;
  if (responseInput.action === 'win' && !choices.winning) return null;
  if (responseInput.action === 'pong' && !choices.pong) return null;
  if (responseInput.action === 'kong' && !choices.openKong) return null;
  if (responseInput.action === 'chi') {
    const player = stateInput.players[responseInput.seat];
    const picked = chiTileIds.map((id) => player.hand.find((tile) => tile.id === id));
    if (picked.length !== 2 || picked.some((tile) => !tile) || picked[0]!.id === picked[1]!.id) return null;
    const selectedFaces = picked.map((tile) => tile!.face).sort().join(',');
    const option = choices.chiOptions.find((choice) => choice.tileIds.length === 2 && choice.tileIds.every((id) => chiTileIds.includes(id)) && choice.faces.slice().sort().join(',') === selectedFaces);
    if (!option) return null;
    normalized = { ...responseInput, chiFaces: option.faces };
  }
  const responses = { ...pending.responses, [responseInput.seat]: normalized };
  const state = { ...stateInput, pendingClaim: { ...pending, responses } };
  if (pending.eligibleSeats.every((eligibleSeat) => responses[eligibleSeat])) {
    const winner = resolveClaimResponses(Object.values(responses), pending.fromSeat, state.players.length);
    if (winner) return finalizeClaim(state, winner);
    return { ...state, phase: 'draw', turnSeat: ((pending.fromSeat + 1) % state.players.length) as SeatId, pendingClaim: undefined };
  }
  return state;
}

function resolveExpiredClaim(state: OnlineGameState): OnlineGameState {
  const pending = state.pendingClaim;
  if (state.phase !== 'claim' || !pending || Date.now() < Date.parse(pending.deadlineAt)) return state;
  const responses = { ...pending.responses };
  for (const seat of pending.eligibleSeats) responses[seat] ??= { seat, action: 'pass' };
  const winner = resolveClaimResponses(Object.values(responses), pending.fromSeat, state.players.length);
  if (winner) return finalizeClaim({ ...state, pendingClaim: { ...pending, responses } }, winner);
  return { ...state, phase: 'draw', turnSeat: ((pending.fromSeat + 1) % state.players.length) as SeatId, pendingClaim: undefined };
}

function declareKong(state: GameState, seat: SeatId, requested?: KongOption): GameState | null {
  if (!requested || state.phase !== 'discard' || state.turnSeat !== seat) return null;
  const options = canKong(state, seat);
  const selected = options.find((option) => option.kind === requested.kind && option.face === requested.face &&
    option.meldId === requested.meldId && option.tileIds.slice().sort().join(',') === requested.tileIds.slice().sort().join(','));
  if (!selected || selected.kind === 'open') return null;
  const player = state.players[seat];
  let melds: Meld[];
  let hand: Tile[];
  if (selected.kind === 'concealed') {
    hand = player.hand.filter((tile) => !selected.tileIds.includes(tile.id));
    melds = [...player.melds, { id: crypto.randomUUID(), kind: 'kong', faces: [selected.face, selected.face, selected.face, selected.face], tileIds: selected.tileIds, source: 'concealed' }];
  } else {
    const existing = player.melds.find((meld) => meld.id === selected.meldId && meld.kind === 'triplet');
    if (!existing) return null;
    hand = player.hand.filter((tile) => !selected.tileIds.includes(tile.id));
    melds = player.melds.map((meld) => meld.id === selected.meldId
      ? { ...meld, kind: 'kong', faces: [...meld.faces, selected.face], tileIds: [...meld.tileIds, ...selected.tileIds], source: 'added' } : meld);
  }
  return { ...state, phase: 'draw', turnSeat: seat, eventSeq: state.eventSeq + 1,
    players: state.players.map((item) => item.seat === seat ? { ...item, hand, melds } : item) };
}

function projectState(stateInput: GameState, viewerSeat: number, matchId: string, version: number, members: any[]) {
  const state = stateInput as OnlineGameState;
  const memberBySeat = new Map(members.map((member) => [Number(member.seat), member]));
  const ownPlayer = state.players[viewerSeat];
  return {
    matchId,
    roomId: members[0]?.room_id,
    version,
    mySeat: viewerSeat,
    phase: state.phase,
    turnSeat: state.turnSeat,
    turnNumber: state.turnNumber,
    dealerSeat: state.dealerSeat,
    wallCount: state.wall.length,
    hand: ownPlayer.hand,
    ownKongs: state.phase === 'discard' && state.turnSeat === viewerSeat ? canKong(state, viewerSeat as SeatId) : [],
    claim: state.phase === 'claim' && state.pendingClaim ? {
      fromSeat: state.pendingClaim!.fromSeat,
      tile: state.pendingClaim!.tile,
      deadlineAt: state.pendingClaim!.deadlineAt,
      choices: claimChoices(state, viewerSeat),
      responded: Boolean(state.pendingClaim!.responses[viewerSeat]),
    } : null,
    players: state.players.map((player) => {
      const member = memberBySeat.get(player.seat);
      return {
        seat: player.seat,
        name: member?.display_name ?? '棋友',
        controller: member?.controller ?? 'human',
        handCount: player.hand.length,
        discards: player.discards,
        melds: player.melds,
        score: player.score,
      };
    }),
    result: state.result ?? null,
  };
}

function publicEvent(state: GameState, action: string) {
  return {
    action,
    phase: state.phase,
    turnSeat: state.turnSeat,
    turnNumber: state.turnNumber,
    wallCount: state.wall.length,
    handCounts: state.players.map((player) => player.hand.length),
    latestDiscard: state.players.flatMap((player) => player.discards.slice(-1).map((tile) => ({ seat: player.seat, face: tile.face }))).at(-1) ?? null,
    result: state.result ?? null,
  };
}

function chooseAiDiscard(hand: Tile[]): Tile {
  const sorted = sortTiles(hand);
  const counts = new Map<string, number>();
  sorted.forEach((tile) => counts.set(tile.face, (counts.get(tile.face) ?? 0) + 1));
  const neighborRanks: Record<string, string[]> = {
    general: ['advisor', 'elephant'], advisor: ['general', 'elephant'], elephant: ['general', 'advisor'],
    chariot: ['horse', 'cannon'], horse: ['chariot', 'cannon'], cannon: ['chariot', 'horse'], soldier: [],
  };
  const value = (tile: Tile) => {
    const [color, rank] = tile.face.split(':');
    return (counts.get(tile.face) ?? 1) * 10 + neighborRanks[rank].filter((neighbor) => counts.has(`${color}:${neighbor}`)).length * 2;
  };
  return sorted.reduce((worst, tile) => value(tile) < value(worst) ? tile : worst, sorted[0]);
}

function runAiTurns(input: GameState, members: any[]): GameState {
  const humans = new Set(members.filter((member) => member.controller === 'human').map((member) => Number(member.seat)));
  let state = input as OnlineGameState;
  let guard = 0;
  while (state.phase !== 'ended' && guard < 40) {
    guard += 1;
    if (state.phase === 'claim') {
      const pending = state.pendingClaim;
      const aiSeat = pending?.eligibleSeats.find((seat) => !humans.has(seat) && !pending.responses[seat]);
      if (!pending || aiSeat === undefined) break;
      const choices = claimChoices(state, aiSeat)!;
      const response: ClaimResponse = { seat: aiSeat, action: choices.winning ? 'win' : choices.pong ? 'pong' : choices.openKong ? 'kong' : choices.chiOptions.length ? 'chi' : 'pass' };
      const chiTileIds = choices.chiOptions[0]?.tileIds ?? [];
      const next = submitClaim(state, response, chiTileIds);
      if (!next) break;
      state = next;
      continue;
    }
    if (humans.has(state.turnSeat)) break;
    if (state.phase === 'draw') {
      const drawn = drawTile(state, state.turnSeat);
      if (!drawn.ok) break;
      state = drawn.state;
      if (state.phase === 'ended') break;
      const player = state.players[state.turnSeat];
      if (isWinningHand(player.hand, player.melds, state.ruleSet)) {
        const source = state.wall.length === 0 ? 'last-tile' : 'self-draw';
        const won = declareSelfDraw(state, player.seat, source);
        if (won.ok) state = applySettlement(won.state, evaluateScore(won.state, player.seat, source), player.seat, true);
        break;
      }
    }
    if (state.phase === 'initial-discard' || state.phase === 'discard') {
      const player = state.players[state.turnSeat];
      const discarded = discardTile(state, player.seat, chooseAiDiscard(player.hand).id);
      if (!discarded.ok) break;
      state = beginDiscardClaims(discarded.state, player.seat);
    }
  }
  return state;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceRoleKey || !authorization) return response({ error: 'server_configuration_error' }, 500);

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return response({ error: 'authentication_required' }, 401);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await request.json() as RequestBody;
    if (body.action === 'start' && body.roomId) {
      const { data: room, error: roomError } = await admin.from('chessmj_rooms').select('*').eq('id', body.roomId).maybeSingle();
      if (roomError || !room) return response({ error: 'room_not_found' }, 404);
      if (room.host_user_id !== user.id) return response({ error: 'host_required' }, 403);
      const { data: members, error: memberError } = await admin.from('chessmj_room_members').select('*').eq('room_id', room.id).order('seat');
      if (memberError) return response({ error: 'room_read_failed' }, 500);
      if (!members.some((member) => member.user_id === user.id)) return response({ error: 'room_membership_required' }, 403);
      const seed = crypto.randomUUID();
      const rules = { ...DEFAULT_RULE_SET, ...room.rules, seatCount: room.seat_count as RuleSet['seatCount'] };
      const state = createGame(rules, seed, 0);
      const { data: matchId, error } = await admin.rpc('chessmj_start_match', { p_room_id: room.id, p_state: state, p_seed: seed });
      if (error) return response({ error: errorMessage(error, 'match_start_failed') }, 409);
      return response({ matchId });
    }

    if (body.action === 'resume_code' && body.roomCode) {
      const { data: room } = await admin.from('chessmj_rooms').select('id').eq('room_code', body.roomCode.trim().toUpperCase()).maybeSingle();
      if (!room) return response({ error: 'room_not_found' }, 404);
      const { data: membership } = await admin.from('chessmj_room_members').select('seat').eq('room_id', room.id).eq('user_id', user.id).maybeSingle();
      if (!membership) return response({ error: 'room_membership_required' }, 403);
      const { data: match } = await admin.from('chessmj_matches').select('id,room_id,state,state_version,status')
        .eq('room_id', room.id).order('round_no', { ascending: false }).limit(1).maybeSingle();
      if (!match) return response({ roomId: room.id, state: null });
      const { data: members } = await admin.from('chessmj_room_members').select('*').eq('room_id', room.id).order('seat');
      return response({ roomId: room.id, matchId: match.id, status: match.status,
        state: projectState(match.state as GameState, Number(membership.seat), match.id, Number(match.state_version), members ?? []) });
    }

    if ((body.action === 'resume' || body.action === 'state') && body.roomId) {
      const { data: membership } = await admin.from('chessmj_room_members').select('seat').eq('room_id', body.roomId).eq('user_id', user.id).maybeSingle();
      if (!membership) return response({ error: 'room_membership_required' }, 403);
      const { data: match } = await admin.from('chessmj_matches').select('id,room_id,state,state_version,status')
        .eq('room_id', body.roomId).order('round_no', { ascending: false }).limit(1).maybeSingle();
      if (!match) return response({ error: 'room_has_no_match' }, 404);
      const { data: members } = await admin.from('chessmj_room_members').select('*').eq('room_id', body.roomId).order('seat');
      return response({ matchId: match.id, status: match.status, state: projectState(match.state as GameState, Number(membership.seat), match.id, Number(match.state_version), members ?? []) });
    }

    if ((body.action === 'draw' || body.action === 'discard' || body.action === 'self_draw' || body.action === 'claim' ||
      body.action === 'resolve_claims' || body.action === 'declare_kong') && body.matchId) {
      if (!Number.isInteger(body.expectedVersion) || !body.requestId) return response({ error: 'invalid_action_request' }, 400);
      const { data: match, error: matchError } = await admin.from('chessmj_matches').select('*').eq('id', body.matchId).maybeSingle();
      if (matchError || !match || match.status !== 'active') return response({ error: 'active_match_not_found' }, 404);
      const { data: membership } = await admin.from('chessmj_room_members').select('seat,controller').eq('room_id', match.room_id).eq('user_id', user.id).maybeSingle();
      if (!membership) return response({ error: 'room_membership_required' }, 403);
      const seat = Number(membership.seat) as SeatId;
      let current = match.state as OnlineGameState;
      let expectedVersion = Number(match.state_version);
      if (expectedVersion !== body.expectedVersion && body.action !== 'claim' && body.action !== 'resolve_claims') {
        return response({ error: 'stale_match_version' }, 409);
      }

      let next: OnlineGameState | null = null;
      if (body.action === 'draw') {
        const result = drawTile(current, seat);
        if (result.ok) next = result.state as OnlineGameState;
        else return response({ error: result.error }, 409);
      } else if (body.action === 'discard' && body.tileId) {
        const result = discardTile(current, seat, body.tileId);
        if (result.ok) next = beginDiscardClaims(result.state, seat);
        else return response({ error: result.error }, 409);
      } else if (body.action === 'self_draw') {
        const source = current.wall.length === 0 ? 'last-tile' : 'self-draw';
        const result = declareSelfDraw(current, seat, source);
        if (!result.ok) return response({ error: result.error }, 409);
        next = applySettlement(result.state, evaluateScore(result.state, seat, source), seat, true) as OnlineGameState;
      } else if (body.action === 'claim' && body.claimAction) {
        if (current.pendingClaim && Date.now() >= Date.parse(current.pendingClaim.deadlineAt)) {
          next = resolveExpiredClaim(current);
          if (next === current) return response({ error: 'claim_not_legal' }, 409);
        } else {
          next = submitClaim(current, { seat, action: body.claimAction }, body.chiTileIds ?? []);
          if (!next) return response({ error: 'claim_not_legal' }, 409);
        }
      } else if (body.action === 'resolve_claims') {
        const resolved = resolveExpiredClaim(current);
        if (resolved === current || resolved.phase === 'claim') return response({ error: 'claim_deadline_not_reached' }, 409);
        next = resolved;
      } else if (body.action === 'declare_kong') {
        next = declareKong(current, seat, body.kongOption) as OnlineGameState | null;
        if (!next) return response({ error: 'kong_not_legal' }, 409);
      }
      if (!next) return response({ error: 'invalid_action_request' }, 400);
      next = runAiTurns(next, (await admin.from('chessmj_room_members').select('*').eq('room_id', match.room_id).order('seat')).data ?? []);
      const ended = next.phase === 'ended';
      const result = ended ? {
        winnerSeat: next.result?.winnerSeat ?? null,
        source: next.result?.source ?? null,
        scoreBreakdown: next.result?.winnerSeat === null || next.result?.winnerSeat === undefined
          ? {} : evaluateScore(next, next.result.winnerSeat, next.result.source ?? 'self-draw'),
        finalScores: next.players.map((player) => ({ seat: player.seat, score: player.score })),
      } : null;
      const { data: eventSeq, error: saveError } = await admin.rpc('chessmj_commit_match_action', {
        p_match_id: match.id,
        p_expected_version: expectedVersion,
        p_request_id: body.requestId,
        p_actor_seat: seat,
        p_state: next,
        p_event_type: ended ? 'match_ended' : body.action,
        p_public_payload: publicEvent(next, body.action),
        p_status: ended ? 'ended' : 'active',
        p_result: result,
      });
      if (saveError) return response({ error: errorMessage(saveError, 'match_action_failed') }, 409);
      const { data: members } = await admin.from('chessmj_room_members').select('*').eq('room_id', match.room_id).order('seat');
      return response({ eventSeq, status: ended ? 'ended' : 'active', state: projectState(next, seat, match.id, eventSeq - 1, members ?? []) });
    }

    return response({ error: 'invalid_request' }, 400);
  } catch {
    return response({ error: 'request_failed' }, 400);
  }
});
