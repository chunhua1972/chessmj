export const PIECE_RANKS = [
  'general', 'advisor', 'elephant', 'chariot', 'horse', 'cannon', 'soldier',
] as const;

export type TileColor = 'red' | 'black';
export type PieceRank = (typeof PIECE_RANKS)[number];
export type TileFaceId = `${TileColor}:${PieceRank}`;
export type SeatId = 0 | 1 | 2 | 3;
export type GamePhase = 'initial-discard' | 'draw' | 'discard' | 'ended';
export type MeldKind = 'sequence' | 'triplet' | 'kong';
export type WinSource = 'self-draw' | 'discard' | 'kong-replacement' | 'last-tile';

export interface Tile {
  id: string;
  face: TileFaceId;
  copy: 0 | 1 | 2 | 3;
}

export interface Meld {
  id: string;
  kind: MeldKind;
  faces: TileFaceId[];
  tileIds: string[];
  source: 'concealed' | 'discard' | 'added';
  fromSeat?: SeatId;
}

export interface ScorePattern {
  id: string;
  tai: number;
  replaces?: string[];
}

export interface RuleSet {
  id: string;
  version: number;
  tileSet: 'xiangqi-56';
  seatCount: 2 | 3 | 4;
  dealerHandSize: 8;
  otherHandSize: 7;
  meldsToWin: 2;
  allowChi: boolean;
  allowPong: boolean;
  allowKong: boolean;
  allowMultiHu: boolean;
  declareReady: 'optional' | 'required' | 'disabled';
  claimTimeoutMs: number;
  scoring: ScorePattern[];
  rulesHash: string;
}

export interface PlayerState {
  seat: SeatId;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  score: number;
  isReady: boolean;
  readyWaits?: TileFaceId[];
  connected: boolean;
}

export interface RoundResult {
  winnerSeat: SeatId | null;
  source?: WinSource;
  reason?: 'wall-empty' | 'win';
}

export interface GameState {
  id: string;
  phase: GamePhase;
  ruleSet: RuleSet;
  dealerSeat: SeatId;
  turnSeat: SeatId;
  wall: Tile[];
  players: PlayerState[];
  turnNumber: number;
  eventSeq: number;
  seed: string;
  result?: RoundResult;
}

export type ClaimAction = 'pass' | 'chi' | 'pong' | 'kong' | 'win';
export interface ClaimResponse {
  seat: SeatId;
  action: ClaimAction;
  chiFaces?: TileFaceId[];
}

export interface ScoreBreakdown {
  totalTai: number;
  patterns: Array<{ patternId: string; tai: number; replaces?: string[] }>;
}

export const DEFAULT_RULE_SET: RuleSet = {
  id: 'tw-56-v1', version: 1, tileSet: 'xiangqi-56', seatCount: 4,
  dealerHandSize: 8, otherHandSize: 7, meldsToWin: 2,
  allowChi: true, allowPong: true, allowKong: true, allowMultiHu: false,
  declareReady: 'optional', claimTimeoutMs: 8_000,
  scoring: [
    { id: 'win', tai: 1 }, { id: 'self-draw', tai: 1 }, { id: 'dealer', tai: 1 },
    { id: 'ready', tai: 1 }, { id: 'one-color', tai: 1 }, { id: 'all-triplets', tai: 2 },
    { id: 'closed-self-draw', tai: 3, replaces: ['self-draw'] },
    { id: 'dragon-run', tai: 4 }, { id: 'kong-blossom', tai: 2 },
    { id: 'heavenly-win', tai: 8 },
  ],
  rulesHash: 'xiangqi-56:v1:tw-default',
};

export const RANK_LABELS: Record<PieceRank, { red: string; black: string; order: number }> = {
  general: { red: '帥', black: '將', order: 0 },
  advisor: { red: '仕', black: '士', order: 1 },
  elephant: { red: '相', black: '象', order: 2 },
  chariot: { red: '俥', black: '車', order: 3 },
  horse: { red: '傌', black: '馬', order: 4 },
  cannon: { red: '炮', black: '砲', order: 5 },
  soldier: { red: '兵', black: '卒', order: 6 },
};

export function faceOf(color: TileColor, rank: PieceRank): TileFaceId {
  return `${color}:${rank}`;
}

export function parseFace(face: TileFaceId): { color: TileColor; rank: PieceRank } {
  const [color, rank] = face.split(':') as [TileColor, PieceRank];
  return { color, rank };
}

export function faceLabel(face: TileFaceId): string {
  const { color, rank } = parseFace(face);
  return RANK_LABELS[rank][color];
}

export function faceColor(face: TileFaceId): TileColor {
  return parseFace(face).color;
}

export function compareFaces(a: TileFaceId, b: TileFaceId): number {
  const af = parseFace(a);
  const bf = parseFace(b);
  return af.color.localeCompare(bf.color) || RANK_LABELS[af.rank].order - RANK_LABELS[bf.rank].order;
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => compareFaces(a.face, b.face) || a.copy - b.copy);
}

export function createTileSet(): Tile[] {
  return (['red', 'black'] as const).flatMap((color) =>
    PIECE_RANKS.flatMap((rank) => [0, 1, 2, 3].map((copy) => ({
      id: `${color}-${rank}-${copy}`,
      face: faceOf(color, rank),
      copy: copy as Tile['copy'],
    }))),
  );
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleTiles(tiles: Tile[], seed: string): Tile[] {
  const shuffled = [...tiles];
  const random = mulberry32(hashSeed(seed));
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface DealResult {
  hands: Record<number, Tile[]>;
  wall: Tile[];
}

export function dealInitialHands(tiles: Tile[], rules: RuleSet, dealer: SeatId): DealResult {
  const needed = rules.dealerHandSize + (rules.seatCount - 1) * rules.otherHandSize;
  if (tiles.length < needed) throw new Error('牌數不足，無法完成發牌');
  const hands: Record<number, Tile[]> = {};
  for (let seat = 0; seat < rules.seatCount; seat += 1) {
    hands[seat] = [];
  }
  let cursor = 0;
  for (let i = 0; i < rules.dealerHandSize; i += 1) hands[dealer].push(tiles[cursor++]);
  for (let i = 0; i < rules.otherHandSize; i += 1) {
    for (let offset = 1; offset < rules.seatCount; offset += 1) {
      const seat = (dealer + offset) % rules.seatCount;
      hands[seat].push(tiles[cursor++]);
    }
  }
  for (const seat of Object.keys(hands)) hands[Number(seat)] = sortTiles(hands[Number(seat)]);
  return { hands, wall: tiles.slice(cursor) };
}

export function createGame(rules: RuleSet = DEFAULT_RULE_SET, seed: string = crypto.randomUUID(), dealerSeat: SeatId = 0): GameState {
  const { hands, wall } = dealInitialHands(shuffleTiles(createTileSet(), seed), rules, dealerSeat);
  return {
    id: `round-${seed.slice(0, 8)}`, phase: 'initial-discard', ruleSet: rules,
    dealerSeat, turnSeat: dealerSeat, wall,
    players: Array.from({ length: rules.seatCount }, (_, seat) => ({
      seat: seat as SeatId, hand: hands[seat], melds: [], discards: [], score: 0,
      isReady: false, connected: true,
    })),
    turnNumber: 0, eventSeq: 0, seed,
  };
}

export function getChiOptions(hand: Tile[], discarded: Tile, rules: RuleSet = DEFAULT_RULE_SET): TileFaceId[][] {
  if (!rules.allowChi) return [];
  const { color, rank } = parseFace(discarded.face);
  const options: TileFaceId[][] = [];
  for (const sequence of [
    ['general', 'advisor', 'elephant'] as const,
    ['chariot', 'horse', 'cannon'] as const,
  ]) {
    if (!sequence.some((piece) => piece === rank)) continue;
    const faces = sequence.map((piece) => faceOf(color, piece));
    const needed = faces.filter((face) => face !== discarded.face);
    if (needed.every((face) => hand.some((tile) => tile.face === face))) options.push(needed);
  }
  return options;
}

export function canPong(hand: Tile[], discarded: Tile, rules: RuleSet = DEFAULT_RULE_SET): boolean {
  return rules.allowPong && hand.filter((tile) => tile.face === discarded.face).length >= 2;
}

export interface KongOption {
  kind: 'concealed' | 'open' | 'added';
  face: TileFaceId;
  tileIds: string[];
  meldId?: string;
}

export function canKong(state: GameState, seat: SeatId, discarded?: Tile): KongOption[] {
  if (!state.ruleSet.allowKong || state.wall.length === 0) return [];
  const player = state.players[seat];
  if (!player) return [];
  const counts = new Map<TileFaceId, Tile[]>();
  for (const tile of player.hand) counts.set(tile.face, [...(counts.get(tile.face) ?? []), tile]);
  const options: KongOption[] = [];
  for (const [face, tiles] of counts) {
    if (tiles.length === 4) options.push({ kind: 'concealed', face, tileIds: tiles.map((tile) => tile.id) });
    if (tiles.length >= 3 && discarded?.face === face) options.push({ kind: 'open', face, tileIds: tiles.slice(0, 3).map((tile) => tile.id) });
    if (tiles.length && player.melds.some((meld) => meld.kind === 'triplet' && meld.faces[0] === face)) {
      const meld = player.melds.find((item) => item.kind === 'triplet' && item.faces[0] === face)!;
      options.push({ kind: 'added', face, tileIds: [tiles[0].id], meldId: meld.id });
    }
  }
  return options;
}

function removeFaces(counts: number[], group: number[]): number[] {
  const result = [...counts];
  for (const index of group) {
    result[index] -= 1;
    if (result[index] < 0) return counts;
  }
  return result;
}

function faceIndex(face: TileFaceId): number {
  const { color, rank } = parseFace(face);
  return (color === 'red' ? 0 : 7) + PIECE_RANKS.indexOf(rank);
}

function isCompleteGroups(counts: number[], groupsLeft: number, memo: Map<string, boolean>): boolean {
  if (groupsLeft === 0) return counts.every((count) => count === 0);
  const key = `${groupsLeft}|${counts.join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return groupsLeft === 0;
  if (counts[first] >= 3 && isCompleteGroups(removeFaces(counts, [first, first, first]), groupsLeft - 1, memo)) {
    memo.set(key, true); return true;
  }
  const colorStart = first < 7 ? 0 : 7;
  const rank = first - colorStart;
  if (rank === 0 || rank === 3) {
    if (counts[first + 1] > 0 && counts[first + 2] > 0 &&
      isCompleteGroups(removeFaces(counts, [first, first + 1, first + 2]), groupsLeft - 1, memo)) {
      memo.set(key, true); return true;
    }
  }
  memo.set(key, false);
  return false;
}

function isTripletOnlyGroups(counts: number[], groupsLeft: number, memo: Map<string, boolean>): boolean {
  if (groupsLeft === 0) return counts.every((count) => count === 0);
  const key = `${groupsLeft}|${counts.join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const first = counts.findIndex((count) => count > 0);
  const result = first >= 0 && counts[first] >= 3 &&
    isTripletOnlyGroups(removeFaces(counts, [first, first, first]), groupsLeft - 1, memo);
  memo.set(key, result);
  return result;
}

export function isWinningHand(hand: Tile[], exposedMelds: Meld[] = [], rules: RuleSet = DEFAULT_RULE_SET): boolean {
  const groupsNeeded = rules.meldsToWin - exposedMelds.length;
  if (groupsNeeded < 0 || hand.length !== groupsNeeded * 3 + 2) return false;
  const counts = Array<number>(14).fill(0);
  for (const tile of hand) counts[faceIndex(tile.face)] += 1;
  const memo = new Map<string, boolean>();
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] >= 2) {
      const reduced = [...counts]; reduced[i] -= 2;
      if (isCompleteGroups(reduced, groupsNeeded, memo)) return true;
    }
  }
  return false;
}

export function getWinningWaits(hand: Tile[], exposedMelds: Meld[] = [], rules: RuleSet = DEFAULT_RULE_SET, visibleTiles: Tile[] = []): TileFaceId[] {
  const waits: TileFaceId[] = [];
  for (const color of ['red', 'black'] as const) {
    for (const rank of PIECE_RANKS) {
      const face = faceOf(color, rank);
      const known = hand.filter((tile) => tile.face === face).length + visibleTiles.filter((tile) => tile.face === face).length;
      if (known < 4 && isWinningHand([...hand, { id: `wait-${face}`, face, copy: 0 }], exposedMelds, rules)) waits.push(face);
    }
  }
  return waits;
}

function canCompleteWithPartial(counts: number[], groupsLeft: number, pairUsed: boolean, memo: Map<string, number>): number {
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return 0;
  const key = `${groupsLeft}|${pairUsed ? 1 : 0}|${counts.join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let best = 0;
  const tryGroup = (indices: number[], completed: boolean) => {
    const reduced = removeFaces(counts, indices);
    if (reduced === counts) return;
    const rest = canCompleteWithPartial(reduced, groupsLeft - (completed ? 1 : 0), pairUsed, memo);
    best = Math.max(best, (completed ? 2 : 1) + rest);
  };
  if (groupsLeft > 0 && counts[first] >= 3) tryGroup([first, first, first], true);
  if (groupsLeft > 0) {
    const colorStart = first < 7 ? 0 : 7;
    const rank = first - colorStart;
    if ((rank === 0 || rank === 3) && counts[first + 1] && counts[first + 2]) tryGroup([first, first + 1, first + 2], true);
  }
  if (!pairUsed && counts[first] >= 2) {
    const reduced = removeFaces(counts, [first, first]);
    best = Math.max(best, 1 + canCompleteWithPartial(reduced, groupsLeft, true, memo));
  }
  if (groupsLeft > 0 && counts[first] >= 2) tryGroup([first, first], false);
  if (groupsLeft > 0) {
    const colorStart = first < 7 ? 0 : 7;
    const rank = first - colorStart;
    if ((rank === 0 || rank === 1 || rank === 3 || rank === 4) && counts[first + 1]) tryGroup([first, first + 1], false);
  }
  best = Math.max(best, canCompleteWithPartial(removeFaces(counts, [first]), groupsLeft, pairUsed, memo));
  memo.set(key, best);
  return best;
}

export function getShanten(hand: Tile[], exposedMelds: Meld[] = [], rules: RuleSet = DEFAULT_RULE_SET): number {
  const groupsLeft = Math.max(0, rules.meldsToWin - exposedMelds.length);
  const counts = Array<number>(14).fill(0);
  for (const tile of hand) counts[faceIndex(tile.face)] += 1;
  const useful = canCompleteWithPartial(counts, groupsLeft, false, new Map());
  return Math.max(-1, groupsLeft * 2 - useful);
}

export type ActionError = 'wrong-phase' | 'not-your-turn' | 'tile-not-in-hand' | 'round-ended' | 'empty-wall' | 'not-winning';
export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: ActionError };

function replacePlayer(state: GameState, player: PlayerState): PlayerState[] {
  return state.players.map((item) => item.seat === player.seat ? player : item);
}

export function drawTile(state: GameState, seat: SeatId): ApplyResult {
  if (state.phase === 'ended') return { ok: false, error: 'round-ended' };
  if (state.phase !== 'draw') return { ok: false, error: 'wrong-phase' };
  if (seat !== state.turnSeat) return { ok: false, error: 'not-your-turn' };
  if (!state.wall.length) return { ok: true, state: { ...state, phase: 'ended', result: { winnerSeat: null, reason: 'wall-empty' }, eventSeq: state.eventSeq + 1 } };
  const [tile, ...wall] = state.wall;
  const player = state.players[seat];
  return { ok: true, state: { ...state, phase: 'discard', wall,
    players: replacePlayer(state, { ...player, hand: sortTiles([...player.hand, tile]) }),
    eventSeq: state.eventSeq + 1 } };
}

export function discardTile(state: GameState, seat: SeatId, tileId: string): ApplyResult {
  if (state.phase === 'ended') return { ok: false, error: 'round-ended' };
  if (state.phase !== 'initial-discard' && state.phase !== 'discard') return { ok: false, error: 'wrong-phase' };
  if (seat !== state.turnSeat) return { ok: false, error: 'not-your-turn' };
  const player = state.players[seat];
  const tile = player.hand.find((item) => item.id === tileId);
  if (!tile) return { ok: false, error: 'tile-not-in-hand' };
  const next = ((seat + 1) % state.players.length) as SeatId;
  return { ok: true, state: { ...state, phase: 'draw', turnSeat: next, turnNumber: state.turnNumber + 1,
    players: replacePlayer(state, { ...player, hand: player.hand.filter((item) => item.id !== tileId), discards: [...player.discards, tile] }),
    eventSeq: state.eventSeq + 1 } };
}

export function declareSelfDraw(state: GameState, seat: SeatId, source: WinSource = 'self-draw'): ApplyResult {
  if (state.phase !== 'discard' || seat !== state.turnSeat) return { ok: false, error: 'wrong-phase' };
  const player = state.players[seat];
  if (!isWinningHand(player.hand, player.melds, state.ruleSet)) return { ok: false, error: 'not-winning' };
  return { ok: true, state: { ...state, phase: 'ended', result: { winnerSeat: seat, source, reason: 'win' }, eventSeq: state.eventSeq + 1 } };
}

export function resolveClaimResponses(responses: ClaimResponse[], fromSeat: SeatId, seatCount: number): ClaimResponse | null {
  const priority: Record<ClaimAction, number> = { pass: 0, chi: 1, pong: 2, kong: 2, win: 3 };
  const eligible = responses.filter((response) => response.action !== 'pass' && response.seat !== fromSeat);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => priority[b.action] - priority[a.action] ||
    ((a.seat - fromSeat + seatCount) % seatCount || seatCount) - ((b.seat - fromSeat + seatCount) % seatCount || seatCount))[0];
}

export function evaluateScore(state: GameState, winner: SeatId, source: WinSource): ScoreBreakdown {
  const player = state.players[winner];
  const allTiles = [...player.hand, ...player.melds.flatMap((meld) => meld.faces.map((face, index) => ({ id: `${meld.id}-${index}`, face, copy: 0 as const })))];
  const colors = new Set(allTiles.map((tile) => faceColor(tile.face)));
  const patterns = new Map(state.ruleSet.scoring.map((pattern) => [pattern.id, pattern]));
  const selected = ['win'];
  if (source === 'self-draw' || source === 'kong-replacement' || source === 'last-tile') selected.push('self-draw');
  if (winner === state.dealerSeat) selected.push('dealer');
  if (player.isReady) selected.push('ready');
  if (colors.size === 1) selected.push('one-color');
  const groupsNeeded = state.ruleSet.meldsToWin - player.melds.length;
  const counts = Array<number>(14).fill(0);
  for (const tile of player.hand) counts[faceIndex(tile.face)] += 1;
  const allTripletExposed = player.melds.every((meld) => meld.kind !== 'sequence');
  const allTripletConcealed = Array.from({ length: counts.length }, (_, pair) => {
    if (counts[pair] < 2) return false;
    const reduced = [...counts]; reduced[pair] -= 2;
    return isTripletOnlyGroups(reduced, groupsNeeded, new Map());
  }).some(Boolean);
  if (allTripletExposed && allTripletConcealed) selected.push('all-triplets');
  if (source === 'kong-replacement') selected.push('kong-blossom');
  const isClosed = player.melds.every((meld) => meld.source === 'concealed');
  if (isClosed && selected.includes('self-draw')) selected.push('closed-self-draw');
  const chosen = selected.map((id) => patterns.get(id)).filter((pattern): pattern is ScorePattern => Boolean(pattern));
  const replaced = new Set(chosen.flatMap((pattern) => pattern.replaces ?? []));
  const effective = chosen.filter((pattern) => !replaced.has(pattern.id));
  return { totalTai: effective.reduce((total, pattern) => total + pattern.tai, 0),
    patterns: effective.map(({ id, tai, replaces }) => ({ patternId: id, tai, replaces })) };
}

export function applySettlement(state: GameState, breakdown: ScoreBreakdown, winner: SeatId, selfDraw: boolean, payerSeat?: SeatId): GameState {
  if (!selfDraw && (payerSeat === undefined || payerSeat === winner)) {
    throw new Error('放銃結算必須提供有效的付款座位');
  }
  const winners = state.players.length - 1;
  const multiplier = state.dealerSeat === winner ? 2 : 1;
  const points = Math.max(1, breakdown.totalTai) * multiplier;
  return { ...state, players: state.players.map((player) => {
    if (player.seat === winner) return { ...player, score: player.score + points * (selfDraw ? winners : 1) };
    const pays = selfDraw ? true : player.seat === payerSeat;
    return { ...player, score: player.score - (pays ? points : 0) };
  }) };
}
