import { useMemo, useState } from 'react';
import OnlineLobby from './online/OnlineLobby';
import {
  applySettlement, createGame, DEFAULT_RULE_SET, declareSelfDraw, discardTile, drawTile,
  evaluateScore, faceColor, faceLabel, getShanten, isWinningHand, sortTiles,
  type GameState, type Tile,
} from './domain/game-engine';

type Screen = 'home' | 'game' | 'rules' | 'history' | 'online';

const BOT_NAMES = ['小棋', '阿墨', '紅豆'];

function PieceTile({ tile, small = false, hidden = false, selected = false, onClick }: {
  tile?: Tile; small?: boolean; hidden?: boolean; selected?: boolean; onClick?: () => void;
}) {
  const color = tile ? faceColor(tile.face) : 'black';
  return (
    <button
      className={`piece-tile ${color} ${small ? 'small' : ''} ${hidden ? 'hidden' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      aria-label={tile ? `${color === 'red' ? '紅' : '黑'}色${faceLabel(tile.face)}` : hidden ? '蓋牌' : '棋子'}
      type="button"
    >
      {hidden ? <span className="tile-back-mark">將</span> : tile ? faceLabel(tile.face) : '？'}
    </button>
  );
}

function TileBack({ small = false }: { small?: boolean }) {
  return <span className={`tile-back ${small ? 'small' : ''}`} aria-hidden="true"><i>象</i></span>;
}

function Icon({ name }: { name: 'sound' | 'help' | 'back' | 'clock' | 'spark' | 'book' | 'chart' | 'arrow' }) {
  const paths: Record<typeof name, string> = {
    sound: 'M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12',
    help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    back: 'm15 18-6-6 6-6',
    clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    spark: 'm12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z',
    book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Zm0 0V19a2 2 0 0 1 2-2h14M8 7h8m-8 4h8',
    chart: 'M4 19V5m0 14h17M8 15l3-4 3 2 5-7',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function newSeed() {
  return `practice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function chooseBotDiscard(hand: Tile[]): Tile {
  const sorted = sortTiles(hand);
  const counts = new Map<string, number>();
  sorted.forEach((tile) => counts.set(tile.face, (counts.get(tile.face) ?? 0) + 1));
  const value = (tile: Tile) => {
    const neighbors: Record<string, string[]> = {
      general: ['advisor', 'elephant'], advisor: ['general', 'elephant'], elephant: ['general', 'advisor'],
      chariot: ['horse', 'cannon'], horse: ['chariot', 'cannon'], cannon: ['chariot', 'horse'], soldier: [],
    };
    const [color, rank] = tile.face.split(':');
    const neighborCount = neighbors[rank].filter((neighbor) => counts.has(`${color}:${neighbor}`)).length;
    return (counts.get(tile.face) ?? 1) * 10 + neighborCount * 2;
  };
  return sorted.reduce((worst, tile) => value(tile) < value(worst) ? tile : worst, sorted[0]);
}

function runBots(input: GameState): GameState {
  let game = input;
  let guard = 0;
  while (game.phase !== 'ended' && game.turnSeat !== 0 && guard < 12) {
    guard += 1;
    if (game.phase === 'draw') {
      const drawn = drawTile(game, game.turnSeat);
      if (!drawn.ok) break;
      game = drawn.state;
      if (game.phase === 'ended') break;
      const bot = game.players[game.turnSeat];
      if (isWinningHand(bot.hand, bot.melds, game.ruleSet)) {
        const win = declareSelfDraw(game, bot.seat, game.wall.length === 0 ? 'last-tile' : 'self-draw');
        if (win.ok) {
          game = applySettlement(win.state, evaluateScore(win.state, bot.seat, game.wall.length === 0 ? 'last-tile' : 'self-draw'), bot.seat, true);
          break;
        }
      }
    }
    if (game.phase === 'discard') {
      const bot = game.players[game.turnSeat];
      const tile = chooseBotDiscard(bot.hand);
      const discarded = discardTile(game, bot.seat, tile.id);
      if (!discarded.ok) break;
      game = discarded.state;
    }
  }
  return game;
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [aiCount, setAiCount] = useState(3);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [rounds, setRounds] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [message, setMessage] = useState('');

  const human = game?.players[0];
  const opponents = useMemo(() => game?.players.slice(1) ?? [], [game]);
  const canDraw = game?.phase === 'draw' && game.turnSeat === 0;
  const canDiscard = game && (game.phase === 'initial-discard' || game.phase === 'discard') && game.turnSeat === 0;
  const canWin = game?.phase === 'discard' && game.turnSeat === 0 && human ? isWinningHand(human.hand, human.melds, game.ruleSet) : false;
  const shanten = human ? getShanten(human.hand, human.melds, game!.ruleSet) : null;

  function startPractice(count = aiCount) {
    const configuredRules = { ...DEFAULT_RULE_SET, seatCount: (count + 1) as 2 | 3 | 4 };
    const freshGame = createGame(configuredRules, newSeed(), 0);
    setGame(freshGame);
    setAiCount(count);
    setMessage('輪到你先打出一枚棋子。');
    setScreen('game');
  }

  function drawForHuman() {
    if (!game || !canDraw) return;
    const result = drawTile(game, 0);
    if (!result.ok) return;
    setGame(result.state);
    setMessage(result.state.phase === 'ended' ? '牌牆已空，本局流局。' : '摸牌完成，選一枚棋子打出。');
  }

  function discardForHuman(tileId: string) {
    if (!game || !canDiscard) return;
    const result = discardTile(game, 0, tileId);
    if (!result.ok) return;
    const withBots = runBots(result.state);
    setGame(withBots);
    if (withBots.phase === 'ended') {
      const winner = withBots.result?.winnerSeat;
      const summary = winner === null || winner === undefined ? '流局' : `${winner === 0 ? '你' : BOT_NAMES[winner - 1]} 胡牌`;
      setLastResult(summary);
      setRounds((current) => current + 1);
      setMessage(summary === '流局' ? '牌牆已空，這局平安結束。' : `${summary}，本局結束。`);
    } else {
      setMessage('對手已完成回合，輪到你摸牌。');
    }
  }

  function winForHuman() {
    if (!game) return;
    const result = declareSelfDraw(game, 0, game.wall.length === 0 ? 'last-tile' : 'self-draw');
    if (!result.ok) return;
    const source = result.state.result?.source ?? 'self-draw';
    const settled = applySettlement(result.state, evaluateScore(result.state, 0, source), 0, true);
    setGame(settled);
    setLastResult('你胡牌');
    setRounds((current) => current + 1);
    setMessage('恭喜胡牌！本局結束。');
  }

  function backToHome() {
    setScreen('home');
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <button className="brand" onClick={backToHome} aria-label="回首頁">
          <span className="brand-mark"><span>將</span><i>士</i></span>
          <span className="brand-name">將士象<span>象棋麻將</span></span>
        </button>
        <nav className="main-nav" aria-label="主要導覽">
          <button className={screen === 'home' ? 'active' : ''} onClick={backToHome}>首頁</button>
          <button className={screen === 'rules' ? 'active' : ''} onClick={() => setScreen('rules')}>玩法說明</button>
          <button className={screen === 'history' ? 'active' : ''} onClick={() => setScreen('history')}>戰績</button>
        </nav>
        <div className="top-actions">
          <button className={`icon-button ${soundOn ? '' : 'muted'}`} onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? '關閉音效' : '開啟音效'} title="音效設定"><Icon name="sound" /></button>
          <button className="avatar-button" onClick={() => setScreen('rules')} aria-label="查看新手說明">新手</button>
        </div>
      </header>

      {screen === 'home' && <section className="home-view">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> 一桌好棋，現在開局</div>
          <h1>棋逢對手，<br /><em>將</em>得精彩。</h1>
          <p>熟悉的象棋棋子，重新組成一場麻將。<br className="desktop-break" />三分鐘上手，隨時都能來一局。</p>
          <div className="hero-buttons">
            <button className="primary-button" onClick={() => startPractice()}><span>開始練習</span><Icon name="arrow" /></button>
            <button className="quiet-button" onClick={() => setScreen('rules')}><Icon name="book" /> 遊戲規則</button>
          </div>
          <div className="seat-picker" aria-label="選擇 AI 對手數">
            <span>對手人數</span>
            {[1, 2, 3].map((count) => <button className={aiCount === count ? 'selected' : ''} onClick={() => setAiCount(count)} key={count} aria-pressed={aiCount === count}>{count} 位</button>)}
          </div>
          <div className="trust-row"><span className="avatar-stack"><i>帥</i><i>馬</i><i>炮</i></span><span>單機練習 · 不需登入</span><span className="trust-divider" /><span>56 枚棋子</span></div>
        </div>

        <div className="hero-art" aria-label="象棋麻將棋子展示">
          <div className="art-glow" />
          <div className="art-caption"><span>RED / BLACK</span><b>棋子入局</b></div>
          <div className="floating-tile tile-a"><PieceTile tile={{ id: 'a', face: 'red:general', copy: 0 }} /></div>
          <div className="floating-tile tile-b"><PieceTile tile={{ id: 'b', face: 'black:horse', copy: 1 }} /></div>
          <div className="floating-tile tile-c"><PieceTile tile={{ id: 'c', face: 'red:cannon', copy: 2 }} /></div>
          <div className="floating-tile tile-d"><PieceTile tile={{ id: 'd', face: 'black:elephant', copy: 3 }} /></div>
          <div className="floating-tile tile-e"><PieceTile tile={{ id: 'e', face: 'red:advisor', copy: 1 }} /></div>
          <div className="art-floor" />
          <div className="art-stats"><div><b>2–4</b><span>人同桌</span></div><span className="stat-line" /><div><b>隨時</b><span>開一局</span></div></div>
        </div>

        <div className="home-bottom">
          <div className="mode-heading"><div><span className="section-kicker">CHOOSE YOUR TABLE</span><h2>今天想怎麼玩？</h2></div><span className="mode-note">選擇模式，馬上開始</span></div>
          <div className="mode-grid">
            <button className="mode-card featured" onClick={() => startPractice()}>
              <span className="mode-icon green-icon"><span>帥</span></span><span className="mode-card-copy"><b>單人練習</b><small>和棋友 AI 輕鬆來一局</small></span><span className="mode-arrow"><Icon name="arrow" /></span>
              <span className="card-tag">離線可玩</span>
            </button>
            <button className="mode-card" onClick={() => setScreen('online')}>
              <span className="mode-icon amber-icon"><span>友</span></span><span className="mode-card-copy"><b>好友對戰</b><small>建立房間，邀請朋友同桌</small></span><span className="mode-arrow"><Icon name="arrow" /></span>
              <span className="card-tag">連線對戰</span>
            </button>
            <button className="mode-card" onClick={() => setScreen('rules')}>
              <span className="mode-icon blue-icon"><span>學</span></span><span className="mode-card-copy"><b>新手教學</b><small>跟著引導，快速學會規則</small></span><span className="mode-arrow"><Icon name="arrow" /></span>
              <span className="card-tag upcoming">即將推出</span>
            </button>
          </div>
          <div className="mini-footer"><span>將士象 <i>·</i> 象棋麻將</span><span>用一副棋子，排一場新局。</span><button onClick={() => setScreen('rules')}>查看計分方式 <Icon name="arrow" /></button></div>
        </div>
      </section>}

      {screen === 'rules' && <section className="content-page">
        <button className="back-link" onClick={backToHome}><Icon name="back" /> 回首頁</button>
        <div className="page-eyebrow">FIRST THINGS FIRST</div><h1>三分鐘，學會開局。</h1>
        <p className="page-lead">將棋子的熟悉感，變成一場簡單好玩的牌局。</p>
        <div className="rules-grid">
          <article className="rule-card"><span className="rule-number">01</span><h3>湊成兩組面子</h3><p>同色的「將、士、象」或「車、馬、包」可以組成順子；三枚相同棋子可以組成刻子。</p><div className="rule-tiles"><PieceTile small tile={{ id: '1', face: 'red:general', copy: 0 }} /><PieceTile small tile={{ id: '2', face: 'red:advisor', copy: 1 }} /><PieceTile small tile={{ id: '3', face: 'red:elephant', copy: 2 }} /><span className="rule-plus">順</span></div></article>
          <article className="rule-card"><span className="rule-number">02</span><h3>再留一對眼</h3><p>胡牌由兩組面子加一對相同棋子組成。紅黑棋子分開計算，卒和兵不能組順子。</p><div className="rule-tiles"><PieceTile small tile={{ id: '4', face: 'black:horse', copy: 0 }} /><PieceTile small tile={{ id: '5', face: 'black:horse', copy: 1 }} /><span className="rule-plus">眼</span></div></article>
          <article className="rule-card"><span className="rule-number">03</span><h3>輪流摸牌、打牌</h3><p>莊家拿八枚，其他玩家各拿七枚。輪到你時先摸一枚，再打出一枚；摸到胡牌組合即可自摸。</p><div className="rule-flow"><span>摸牌</span><b>→</b><span>整理</span><b>→</b><span>打牌</span></div></article>
        </div>
        <div className="rules-callout"><div className="callout-mark">將</div><div><b>目前採用 56 子基本玩法</b><p>計分與特殊牌型仍會逐步完善。好友可透過房間碼同桌，線上動作由伺服器驗證並即時同步。</p></div><button className="primary-button compact" onClick={() => startPractice()}><span>開一局試試</span><Icon name="arrow" /></button></div>
      </section>}

      {screen === 'history' && <section className="content-page history-page">
        <div className="page-eyebrow">YOUR TABLE</div><h1>每一局，都算數。</h1><p className="page-lead">這裡記錄你在此裝置上的練習進度。</p>
        <div className="history-summary"><div><Icon name="chart" /><span>練習局數</span><b>{rounds}</b></div><div><Icon name="spark" /><span>最近結果</span><b className="history-result">{lastResult ?? '尚未開局'}</b></div><div><Icon name="clock" /><span>遊戲紀錄</span><b>{rounds ? '本次工作階段' : '等待第一局'}</b></div></div>
        <button className="primary-button" onClick={() => startPractice()}><span>開始新的一局</span><Icon name="arrow" /></button>
      </section>}

      {screen === 'online' && <OnlineLobby onBack={backToHome} />}

      {screen === 'game' && game && human && <section className="game-screen">
        <div className="game-toolbar"><button className="back-link" onClick={backToHome}><Icon name="back" /> 離開牌桌</button><div className="game-round-label"><span className="live-dot" /> 練習桌 <i>·</i> 第 {game.turnNumber + 1} 巡</div><button className="icon-button" aria-label="遊戲規則" onClick={() => setScreen('rules')}><Icon name="help" /></button></div>
        <div className="game-board">
          <div className="board-topline"><span>標準玩法 <b>·</b> 56 子</span><span className="wall-count">牌牆 <b>{game.wall.length}</b></span></div>
          <div className="opponents-row">
            {opponents.map((player) => <div className={`opponent ${game.turnSeat === player.seat ? 'is-turn' : ''}`} key={player.seat}>
              <span className={`opponent-avatar avatar-${player.seat}`}>{player.seat === 1 ? '棋' : player.seat === 2 ? '馬' : '砲'}</span>
              <div className="opponent-info"><b>{BOT_NAMES[player.seat - 1]}</b><span>{player.seat === game.dealerSeat ? '莊家' : '閒家'} <i>·</i> {player.hand.length} 枚</span></div>
              {game.turnSeat === player.seat && <span className="turn-pulse" />}
              <div className="opponent-hand">{Array.from({ length: Math.min(player.hand.length, 7) }, (_, index) => <TileBack small key={index} />)}</div>
            </div>)}
          </div>
          <div className="table-center">
            <div className="table-center-top"><span className="wind-chip">東</span><span className="table-title">將士象 <i>麻將</i></span><span className="wall-pill">剩餘 {game.wall.length}</span></div>
            <div className="discard-pools">
              {opponents.map((player) => <div className="discard-lane" key={player.seat} aria-label={`${BOT_NAMES[player.seat - 1]}的棄牌`}>
                {player.discards.slice(-6).map((tile) => <PieceTile small tile={tile} key={tile.id} />)}
              </div>)}
              <div className="center-hint">{game.phase === 'ended' ? '本局已結束' : game.turnSeat === 0 ? canDraw ? '輪到你摸牌' : canWin ? '棋型完成，可以胡牌' : '輪到你選牌' : `${BOT_NAMES[game.turnSeat - 1]} 思考中`}</div>
              {human.discards.length > 0 && <div className="discard-lane own-discard-lane" aria-label="你的棄牌">{human.discards.slice(-6).map((tile) => <PieceTile small tile={tile} key={tile.id} />)}</div>}
            </div>
            <div className="table-bottomline"><span><i /> {message || '放輕鬆，慢慢找你的好牌。'}</span><span>東風局</span></div>
          </div>
          <div className="player-zone">
            <div className="player-meta"><div className="player-name"><span className="self-avatar">你</span><div><b>我的牌</b><small>{game.dealerSeat === 0 ? '莊家' : '閒家'} <i>·</i> {human.hand.length} 枚</small></div></div><div className="hand-note">{shanten === 0 ? <><span className="ready-mark">聽</span> 聽牌中</> : shanten !== null && shanten > 0 ? `距離聽牌 ${shanten} 張` : game.phase === 'ended' ? '牌局結束' : '選一枚棋子打出'}</div></div>
            <div className="player-hand" aria-label="你的手牌">
              {human.hand.map((tile) => <PieceTile tile={tile} selected={false} key={tile.id} onClick={canDiscard ? () => discardForHuman(tile.id) : undefined} />)}
            </div>
            <div className="player-actions">
              <div className="action-status">{canDraw ? '輪到你摸牌' : canDiscard ? '選擇一枚棋子打出' : game.phase === 'ended' ? '牌局已結束' : '請稍候'}</div>
              <div className="action-buttons">
                {canWin && <button className="win-button" onClick={winForHuman}>自摸胡牌</button>}
                {canDraw && <button className="primary-button draw-button" onClick={drawForHuman}><span>摸一枚</span><Icon name="arrow" /></button>}
                {game.phase === 'ended' && <button className="primary-button draw-button" onClick={() => startPractice()}><span>再來一局</span><Icon name="arrow" /></button>}
                {canDiscard && <span className="action-tip"><Icon name="spark" /> 點選手牌即可打出</span>}
              </div>
            </div>
          </div>
        </div>
      </section>}

      <footer className="site-footer"><span>© 2026 將士象</span><span>一副棋子，排一場新局。</span><button onClick={() => setScreen('rules')}>玩法與規則</button></footer>
    </main>
  );
}

export default App;
