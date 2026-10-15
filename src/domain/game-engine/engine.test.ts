import { describe, expect, it } from 'vitest';
import {
  applySettlement, canPong, createGame, createTileSet, dealInitialHands, DEFAULT_RULE_SET, evaluateScore, faceOf,
  getChiOptions, getShanten, isWinningHand, resolveClaimResponses, shuffleTiles,
  type PieceRank, type Tile, type TileColor,
} from './index';

function tiles(groups: Array<[TileColor, PieceRank, number]>): Tile[] {
  return groups.flatMap(([color, rank, count], groupIndex) =>
    Array.from({ length: count }, (_, copy) => ({
      id: `fixture-${groupIndex}-${copy}`,
      face: faceOf(color, rank),
      copy: copy as Tile['copy'],
    })),
  );
}

describe('xiangqi 56 tile set', () => {
  it('contains 56 unique pieces, four for each of the 14 faces', () => {
    const set = createTileSet();
    expect(set).toHaveLength(56);
    expect(new Set(set.map((tile) => tile.id)).size).toBe(56);
    expect(new Set(set.map((tile) => tile.face)).size).toBe(14);
    expect(set.every((tile) => set.filter((other) => other.face === tile.face).length === 4)).toBe(true);
  });

  it('shuffles reproducibly without losing pieces', () => {
    const set = createTileSet();
    const first = shuffleTiles(set, 'fixed-seed');
    expect(shuffleTiles(set, 'fixed-seed')).toEqual(first);
    expect(new Set(first.map((tile) => tile.id))).toEqual(new Set(set.map((tile) => tile.id)));
  });

  it.each([2, 3, 4] as const)('deals the right number of pieces for %i seats', (seatCount) => {
    const rules = { ...DEFAULT_RULE_SET, seatCount };
    const dealt = dealInitialHands(shuffleTiles(createTileSet(), 'deal-seed'), rules, 0);
    expect(dealt.hands[0]).toHaveLength(8);
    for (let seat = 1; seat < seatCount; seat += 1) expect(dealt.hands[seat]).toHaveLength(7);
    expect(Object.values(dealt.hands).flat().length + dealt.wall.length).toBe(56);
  });
});

describe('tile combinations', () => {
  it('recognizes the two permitted same-color sequences', () => {
    const hand = tiles([
      ['red', 'advisor', 1], ['red', 'elephant', 1], ['red', 'general', 1],
      ['black', 'chariot', 1], ['black', 'horse', 1], ['black', 'cannon', 1],
      ['red', 'soldier', 2],
    ]);
    expect(isWinningHand(hand)).toBe(true);
  });

  it('reports a ready hand as zero shanten and a winning hand as complete', () => {
    const ready = tiles([
      ['red', 'general', 1], ['red', 'advisor', 1], ['red', 'elephant', 1],
      ['black', 'chariot', 1], ['black', 'horse', 1], ['black', 'soldier', 2],
    ]);
    const winning = [...ready, { id: 'cannon', face: faceOf('black', 'cannon'), copy: 0 as const }];
    expect(getShanten(ready)).toBe(0);
    expect(getShanten(winning)).toBe(-1);
  });

  it('does not allow a sequence across colors', () => {
    const hand = tiles([
      ['red', 'general', 1], ['black', 'advisor', 1], ['red', 'elephant', 1],
      ['black', 'chariot', 3], ['red', 'soldier', 2],
    ]);
    expect(isWinningHand(hand)).toBe(false);
  });

  it('offers chi only when both same-color companions are held', () => {
    const discarded = { id: 'discarded', face: faceOf('red', 'advisor'), copy: 0 } as Tile;
    const hand = [
      { id: 'g', face: faceOf('red', 'general'), copy: 1 },
      { id: 'e', face: faceOf('red', 'elephant'), copy: 1 },
    ] as Tile[];
    expect(getChiOptions(hand, discarded)).toEqual([[faceOf('red', 'general'), faceOf('red', 'elephant')]]);
    expect(getChiOptions(hand.slice(0, 1), discarded)).toEqual([]);
  });

  it('requires two matching tiles for pong', () => {
    const discarded = { id: 'discarded', face: faceOf('black', 'horse'), copy: 0 } as Tile;
    expect(canPong([{ id: 'a', face: discarded.face, copy: 1 }, { id: 'b', face: discarded.face, copy: 2 }], discarded)).toBe(true);
    expect(canPong([{ id: 'a', face: discarded.face, copy: 1 }], discarded)).toBe(false);
  });

  it('resolves by action priority, then nearest seat', () => {
    const winner = resolveClaimResponses([
      { seat: 1, action: 'chi' }, { seat: 2, action: 'pong' }, { seat: 3, action: 'win' },
    ], 0, 4);
    expect(winner?.seat).toBe(3);
    const nearest = resolveClaimResponses([
      { seat: 1, action: 'pong' }, { seat: 3, action: 'pong' },
    ], 0, 4);
    expect(nearest?.seat).toBe(1);
  });

  it('keeps self-draw and discard settlements zero-sum', () => {
    const state = createGame({ ...DEFAULT_RULE_SET, seatCount: 3 }, 'settlement-seed');
    const breakdown = { totalTai: 2, patterns: [{ patternId: 'win', tai: 2 }] };
    const selfDraw = applySettlement(state, breakdown, 0, true);
    const discardWin = applySettlement(state, breakdown, 0, false, 2);
    expect(selfDraw.players.reduce((sum, player) => sum + player.score, 0)).toBe(0);
    expect(discardWin.players.reduce((sum, player) => sum + player.score, 0)).toBe(0);
  });

  it('scores an all-triplets winning hand', () => {
    const state = createGame(DEFAULT_RULE_SET, 'score-seed');
    const hand = tiles([
      ['red', 'general', 3], ['black', 'horse', 3], ['black', 'soldier', 2],
    ]);
    const players = state.players.map((player) => player.seat === 0 ? { ...player, hand } : player);
    const score = evaluateScore({ ...state, players }, 0, 'self-draw');
    expect(score.patterns.some((pattern) => pattern.patternId === 'all-triplets')).toBe(true);
  });
});
