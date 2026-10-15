# 象棋麻將對戰遊戲開發計畫

> 文件版本：1.0（重建稿）  
> 日期：2026-10-15  
> 技術方向：Vite、React、TypeScript、Supabase  
> 平台：iPhone、iPad、Android 手機／平板、桌面瀏覽器

## 文件狀態與規則基準

先前對話的快取只保留了需求，沒有附上已完成的 `DEVplan.md` 正文或檔案。因此這份文件是依原始需求重建的工程計畫，不是對先前檔案的逐字複製。

「象棋麻將」有 32、56、64 子等牌組及不同台數算法。本計畫將台灣常見的 **56 子型**定為第一版基準：14 種棋子面各 4 枚，共 56 枚；莊家 8 枚、其他玩家各 7 枚；胡牌由兩組面子加一對組成。台數、槓牌、多人同時胡牌及 2–3 人桌規則在不同平台可能不同，本文把第一版預設值明確列出，並設計成可由 `RuleSet` 調整。

## 1. 產品目標

### 1.1 第一版目標

- 可單機遊玩：1 位真人對 1–3 位 AI。
- 可建立線上房間：2–4 個座位，可由真人及 AI 組成；支援房主邀請、房間碼加入、準備及開始。
- 以相同的純 TypeScript 規則引擎處理單機、AI 與線上對局；線上模式由伺服器驗證每個動作。
- 手機直向及橫向、平板、桌面均可操作；支援觸控與滑鼠、重新連線、局面恢復及基本無障礙標示。
- 有新手引導、規則說明、牌型計算、局後紀錄與可重播事件。

### 1.2 第一版不包含

- 現金、可兌現籌碼或玩家間交易。
- 排名賽季、好友聊天、觀戰者席位及複雜賽制。
- 32／64 子牌組與地方規則；資料模型保留擴充位置。
- 原生 App 專屬功能。第一版先以 PWA 支援跨平台；需要商店上架時再評估 Capacitor 包裝。

## 2. 遊戲規則（第一版預設）

### 2.1 棋子與牌面

每枚牌以「顏色＋棋子種類」作為牌面 ID。顏色為紅、黑；種類為將／帥、士／仕、象／相、車／俥、馬／傌、包／炮、卒／兵。兩個顏色各有七種牌面，每種牌面四枚，總數為 `2 × 7 × 4 = 56`。

```ts
type TileColor = 'red' | 'black';
type PieceRank = 'general' | 'advisor' | 'elephant' | 'chariot' | 'horse' | 'cannon' | 'soldier';
type TileFaceId = `${TileColor}:${PieceRank}`;
interface Tile { id: string; face: TileFaceId; copy: 0 | 1 | 2 | 3; }
```

`id` 是單枚牌的唯一識別碼；`face` 才代表可用於牌型判斷的相同牌。排序與顯示名稱由牌面字典提供，不可用 UI 文字直接判斷規則。

### 2.2 座位、發牌與牌牆

- 第一版牌組固定 56 枚，支援 2、3、4 個座位；座位可由真人或 AI 佔用。2–3 人局沿用同一牌組及摸打規則，是產品定義的玩法設定。
- 開局從洗勻後的牌堆發牌。莊家 8 枚，其餘座位各 7 枚；莊家先打出一枚。
- 順時針輪轉；未摸牌玩家可以對上一家的棄牌提出吃牌，任何其他玩家可提出碰、槓或胡牌。
- 第一版不留死牌。摸牌牆用盡且沒有胡牌時本局流局。
- 首局由房主選莊或以可重現的隨機種子抽定；下一局由規則引擎依上一局結果決定。預設：莊家胡牌連莊；流局時莊家連莊；其他情況下家接莊。

### 2.3 可組成的面子

- **順子**：同色的 `將－士－象`（或 `帥－仕－相`）及同色的 `車－馬－包`（或 `俥－傌－炮`）。順序固定；卒／兵不參與順子。
- **刻子**：三枚相同 `face` 的牌。
- **槓子**：四枚相同 `face` 的牌；在胡牌判斷中算一組面子，並在宣告後補摸一枚牌。
- **眼（對子）**：兩枚相同 `face` 的牌。
- **胡牌**：兩組面子（順子、刻子或槓子）加一對眼。暗牌部分必須剛好補足未公開的面子與眼。

同色與相同牌面要分開處理：順子要求同色及指定相鄰種類；刻子、槓子、對子要求顏色與棋子種類皆相同。

### 2.4 每回合流程

1. 莊家先打牌；其他回合開始時，當前玩家從牌牆摸一枚，使手牌進入可打牌或自摸胡牌的狀態。
2. 玩家可自摸胡牌、宣告合法槓牌，或選一枚牌打出。打牌後進入棄牌回應階段。
3. 對該棄牌有合法胡、碰、槓、吃的玩家在回應期限內選擇動作或過牌。
4. 回應結束後依優先權決定結果。若無人取牌，輪到下一位玩家摸牌；若有人碰／槓／吃，該玩家取得牌並完成相應動作，再打出一枚牌。
5. 胡牌立即結束本局並結算。牌牆用盡時流局。

槓牌補牌若無牌可摸，第一版不允許宣告該槓。暗槓只可在自己的回合宣告；加槓需已有明刻且手中有第四枚相同牌。明槓可由棄牌者提供第四枚牌。每次槓牌後補摸一枚，補牌也可自摸胡牌。

### 2.5 吃、碰、槓、胡的回應優先權

- 胡牌優先於碰／槓，碰／槓優先於吃。
- 吃只能由棄牌者的下一位玩家提出；碰、明槓、胡可由其他合法玩家提出。
- 多人同時提出胡時，第一版預設由輪轉方向最接近棄牌者的合法玩家胡牌；`allowMultiHu` 預設 `false`，規則可設定為多人胡牌。
- 同一優先級有多個有效回應時，以輪轉方向最接近棄牌者者優先。伺服器以固定的 `discardId`、座位順序及動作優先級結算，避免網路先後順序影響結果。
- 線上回應期限建議 8 秒，可由房間設定調整；超時視為過牌。若玩家已進入聽牌狀態，是否允許放棄可胡的牌由 `mustWinOnDiscard` 控制，預設 `false`。

### 2.6 聽牌

聽牌是玩家現有暗牌只差一枚即可胡牌的狀態。玩家可在出牌前宣告聽牌；宣告後保留的牌型固定，只能摸牌後打出剛摸到的牌，或按規則胡牌。第一版不強制玩家必須喊聽，`requireDeclareReady` 預設 `false`；若宣告聽牌，結算可加聽牌台。

引擎須列出所有可胡牌面（等待牌）供 UI 提示；計算時不可讀取其他玩家的暗牌。只以牌牆、棄牌和公開面子推算可見剩餘張數。

### 2.7 台數與結算

第一版將台數表放入 `RuleSet.scoring`，初始建議採 56 子常見牌型，逐項以測試鎖定：

| 牌型 | 建議台數 | 判定摘要 |
|---|---:|---|
| 胡牌 | 1 | 基本胡牌台 |
| 自摸 | 1 | 最後一枚為自己摸入 |
| 門清 | 1 | 胡牌前沒有吃、碰、明槓或加槓；暗槓是否破門清由設定控制，預設不破 |
| 門清自摸 | 3 | 門清且自摸；取代門清與自摸基本台，避免重複計入 |
| 莊家 | 1 | 胡牌者為莊家 |
| 聽牌 | 1 | 本局已宣告聽牌 |
| 清一色 | 1 | 所有牌面均為紅色或均為黑色 |
| 碰碰胡 | 2 | 兩組面子皆為刻／槓，沒有順子 |
| 一條龍 | 4 | 同色將士象、車馬包及該色卒對子組合 |
| 雙龍抱 | 4 | 兩組同牌面的順子；門清限定 |
| 槓上開花 | 2 | 槓後補摸直接自摸胡牌 |
| 海底撈月 | 3 | 摸取牌牆最後一枚牌後自摸 |
| 河底撈魚 | 1 | 牌牆最後一枚摸出後的棄牌放銃 |
| 天胡 | 8 | 莊家第一手牌即自摸胡牌 |
| 全求 | 2 | 暗牌僅餘眼，其他面子皆由吃／碰／槓公開，並胡別人棄牌 |
| 半求 | 1 | 全求條件成立但自摸 |

「將帥領兵、斷頭尾、四對子、二槓子」等地方牌型可列入後續規則設定。牌型之間的互斥、替代與倍數由 `scorePatterns` 明確表達，不在元件內硬編碼。每個計分項目回傳 `patternId`、台數、判定依據與取代項目，局後可供玩家檢視。

預設以台數總和計算基本點數，再加上莊家連莊倍率；單局轉分為零和：胡牌者從每位未胡玩家收取相同分數，自摸時每位未胡玩家支付同一分數。點數上下限、流局聽牌支付及多人胡牌分攤放入規則設定並為房間固定快照。排行榜分數只作遊戲記錄。

### 2.8 規則設定範例

```ts
interface RuleSet {
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
```

建立牌局時保存 `rulesHash` 及完整設定快照；遊戲中途更新設定不可改變已開始的牌局。

## 3. 遊戲模式與主要畫面

### 3.1 模式

- **單人練習**：本機規則引擎，真人對 AI；可選 1–3 位 AI、AI 難度、是否顯示提示及速度。
- **線上房間**：建立私人房間、輸入房間碼、選座、準備；空位可由房主補 AI。每個座位固定為真人或 AI。
- **教學模式**：引導摸牌、辨識順子／刻子、棄牌回應、胡牌與結算；使用預設局面，不依賴網路。
- **戰績與回放**：顯示局數、勝率、台數摘要及事件回放；不顯示他人暗牌資訊。

### 3.2 響應式版面

- 桌面／平板橫向：中央牌桌、上方對手資訊、兩側棄牌／公開面子、底部自己的手牌與操作列。
- 手機直向：頂端狀態列，中間精簡顯示對手與棄牌，底部手牌固定區；回應吃碰槓胡時以底部操作面板呈現。
- 手機橫向或平板：切換為寬桌配置；畫面旋轉時保留目前選牌與回應倒數。
- 棋子必須同時以字形、顏色標記及形狀／標籤區分；提供色弱模式、放大牌面、減少動畫、音效開關及震動開關。
- 棄牌、手牌、倒數與提示不可只用色彩表示；所有可點區域建議至少 44 × 44 CSS px。
- 手勢只作快捷操作；每個操作也提供可見按鈕，避免拖曳成為唯一操作方式。

### 3.3 React 元件樹

```text
App
├─ Router
├─ AuthGate
├─ HomePage
│  ├─ ModeCardList
│  └─ RulePreviewDialog
├─ LobbyPage
│  ├─ RoomCodePanel
│  ├─ SeatGrid
│  ├─ RuleSettingsForm
│  └─ ReadyButton
├─ GamePage
│  ├─ GameHeader (回合、莊家、牌牆數、連線狀態)
│  ├─ OpponentSeat × (seatCount - 1)
│  ├─ DiscardArea
│  ├─ MeldArea
│  ├─ PlayerHand
│  ├─ TurnActionBar
│  ├─ ClaimDialog (吃／碰／槓／胡／過)
│  ├─ ReconnectBanner
│  └─ GameLogDrawer
├─ ResultDialog
├─ HistoryPage
├─ SettingsPage
└─ Shared (TileView、ScoreBreakdown、Modal、Toast、LoadingState)
```

呈現元件只負責顯示和送出玩家意圖。是否合法、輪到誰、胡牌與台數均由領域引擎回傳，不在 React 元件重複實作。

## 4. 技術架構

### 4.1 分層

```text
React / PWA
  ├─ features (home, lobby, game, history)
  ├─ application (use cases, state orchestration)
  └─ packages/game-engine (純 TypeScript，無 React / Supabase 依賴)
       ├─ model
       ├─ rules
       ├─ actions
       ├─ scoring
       └─ ai
Supabase
  ├─ Auth
  ├─ Postgres + RLS
  ├─ Realtime (房間／局面通知)
  └─ Edge Functions / SQL RPC (伺服器驗證與原子化動作)
```

使用 Vite + React + TypeScript；樣式可用 CSS Modules 或 Tailwind，狀態管理先以 feature-local reducer／Zustand 擇一，伺服器資料透過 Supabase client 封裝在 repository。PWA 使用 manifest 與 service worker 快取靜態檔案。遊戲資源及登入流程不得讓前端取得 `service_role` 金鑰。

### 4.2 建議資料夾

```text
src/
  app/                 # Router、providers、app shell
  features/
    auth/ lobby/ game/ history/ settings/
  components/          # 共用 UI 元件
  lib/supabase/         # client、repositories、generated DB types
  styles/              # tokens、breakpoints、global styles
packages/
  game-engine/
    src/model/ rules/ actions/ scoring/ ai/ index.ts
supabase/
  migrations/ functions/ seed.sql
tests/
  engine/ integration/ e2e/
```

若初期不採 monorepo，可先把 `packages/game-engine` 放在 `src/domain/game-engine`，但依賴方向仍須保持純函式核心不依賴 UI、資料庫或網路。

## 5. 核心資料模型

### 5.1 遊戲引擎型別

```ts
type SeatId = 0 | 1 | 2 | 3;
type GamePhase = 'lobby' | 'initial-discard' | 'draw' | 'discard' | 'claim' | 'ended';
type MeldKind = 'sequence' | 'triplet' | 'kong';
type WinSource = 'self-draw' | 'discard' | 'kong-replacement' | 'last-tile';

interface Meld {
  id: string;
  kind: MeldKind;
  faces: TileFaceId[];
  tileIds: string[];
  source: 'concealed' | 'discard' | 'added';
  fromSeat?: SeatId;
}

interface PlayerState {
  seat: SeatId;
  hand: Tile[];                 // 僅伺服器完整狀態；傳給客戶端時需遮蔽他人手牌
  melds: Meld[];
  discards: Tile[];
  score: number;
  isReady: boolean;
  readyWaits?: TileFaceId[];
  connected: boolean;
}

interface PendingClaim {
  discardId: string;
  tile: Tile;
  fromSeat: SeatId;
  eligibleSeats: SeatId[];
  responses: Partial<Record<SeatId, ClaimResponse>>;
  deadlineAt: string;
}

interface GameState {
  id: string;
  roomId: string;
  phase: GamePhase;
  ruleSet: RuleSet;
  dealerSeat: SeatId;
  turnSeat: SeatId;
  wall: Tile[];
  players: PlayerState[];
  pendingClaim?: PendingClaim;
  turnNumber: number;
  eventSeq: number;
  seed: string;
  result?: RoundResult;
}
```

`GameState` 只供伺服器與本機單機模式完整使用。線上 API 使用 `PublicGameState` 投影，僅回傳登入者自己的手牌、其他玩家牌數、公開棄牌與面子。每個輸入動作帶 `expectedEventSeq`，拒絕過期或重複請求。

### 5.2 Supabase 資料表

- `profiles(id uuid PK references auth.users, display_name, avatar_key, created_at)`
- `game_rooms(id uuid PK, room_code unique, host_user_id, status, seat_count, rules jsonb, rules_hash, created_at, expires_at)`
- `room_members(room_id, seat, user_id nullable, controller, ready, joined_at)`，唯一鍵 `(room_id, seat)` 及 `(room_id, user_id)`；`controller` 為 `human` 或 `ai`。
- `game_rounds(id uuid PK, room_id, round_no, status, state jsonb, state_version, seed, started_at, ended_at)`。僅伺服器角色可讀寫完整 `state`。
- `game_events(round_id, seq, actor_seat, event_type, public_payload jsonb, created_at)`，唯一鍵 `(round_id, seq)`；不記錄可由客戶端讀取的他人暗牌。
- `round_results(round_id PK, winner_seat nullable, win_source nullable, score_breakdown jsonb, final_scores jsonb, ended_at)`。

房間與會員查詢採 RLS；玩家只能查看自己所屬房間的安全投影。不可讓 client 直接更新 `game_rounds.state`、分數、牌牆或其他人的手牌。需要跨表一致性時，以 Edge Function 驗證身分後呼叫交易型 SQL RPC，或將資料驗證和狀態更新封裝於單一 RPC。

## 6. 核心函式與動作 API

以下函式應以純函式為主，輸入與輸出不可就地修改，並回傳明確錯誤碼，方便 UI 顯示及測試。

### 6.1 牌組及發牌

```ts
createTileSet(ruleSet: RuleSet): Tile[]
shuffleTiles(tiles: Tile[], seed: string): Tile[]
dealInitialHands(tiles: Tile[], seats: SeatId[], dealer: SeatId, rules: RuleSet): DealResult
```

隨機洗牌使用可在伺服器執行的安全亂數；`seed` 存於伺服器用於除錯重播，不暴露給客戶端直到牌局結束（避免推算牌牆）。測試可注入固定亂數來源。

### 6.2 規則判斷

```ts
getLegalActions(state: GameState, seat: SeatId): LegalAction[]
getChiOptions(hand: Tile[], discarded: Tile, rules: RuleSet): TileFaceId[][]
canPong(hand: Tile[], discarded: Tile): boolean
canKong(state: GameState, seat: SeatId, tile?: Tile): KongOption[]
isWinningHand(hand: Tile[], exposedMelds: Meld[], rules: RuleSet): boolean
getWinningWaits(hand: Tile[], exposedMelds: Meld[], rules: RuleSet): TileFaceId[]
getShanten(hand: Tile[], exposedMelds: Meld[], rules: RuleSet): number
```

胡牌檢查先減去已公開面子數，再對暗牌做 DFS／記憶化搜尋：嘗試一對眼，接著遞迴取相同牌三張、合法同色順子三張；成功湊足 `meldsToWin` 即可胡。槓在拆解時視為一組面子。輸入牌數不符合結構時回傳非法輸入，而不是誤判為可胡。

### 6.3 狀態轉移

```ts
applyAction(state: GameState, actor: SeatId, action: GameAction): ApplyResult
drawTile(state: GameState, seat: SeatId): ApplyResult
discardTile(state: GameState, seat: SeatId, tileId: string): ApplyResult
submitClaim(state: GameState, seat: SeatId, response: ClaimResponse): ApplyResult
resolveClaims(state: GameState, now: Date): ApplyResult
declareReady(state: GameState, seat: SeatId, discardId: string): ApplyResult
declareKong(state: GameState, seat: SeatId, option: KongOption): ApplyResult
finishRound(state: GameState, result: RoundResult): GameState
```

`applyAction` 必須檢查階段、行動者座位、牌的所有權、輪次、牌張數、動作合法性及事件版本。每次成功轉移產生一個不可變事件（如 `tile_drawn`、`tile_discarded`、`claim_submitted`、`meld_opened`、`round_won`），由事件 reducer 可重建狀態。

### 6.4 計分、遮蔽及序列化

```ts
evaluateScore(state: GameState, winner: SeatId, source: WinSource): ScoreBreakdown
applySettlement(state: GameState, breakdown: ScoreBreakdown): GameState
toPublicState(state: GameState, viewerSeat: SeatId): PublicGameState
serializeGameState(state: GameState): JsonValue
deserializeGameState(raw: JsonValue, rules: RuleSet): GameState
```

結算與牌型判斷應由同一領域模組負責，使用規則快照。序列化需帶 schema version，後續可用 migration 升級進行中的牌局。

## 7. AI 設計

### 7.1 難度層級

- **簡單**：隨機選合法棄牌；若可自摸胡牌則胡；可碰則以設定機率碰；不做牌河推理。
- **普通（預設）**：選擇使 `shanten` 最低、有效進張數最多的棄牌；估算牌牆剩餘張數時只使用自己手牌、公開棄牌及公開面子。
- **困難**：在普通策略上加入對手棄牌危險度、保留高彈性搭子、估計別家聽牌風險；仍限於短時間與可解釋規則，不讀取其他 AI／玩家隱藏牌資訊。

### 7.2 AI 接口

```ts
interface AiDecisionContext {
  state: PublicGameState;
  ownHand: Tile[];
  legalActions: LegalAction[];
  difficulty: 'easy' | 'normal' | 'hard';
  random: RandomSource;
}
chooseDiscard(context: AiDecisionContext): string
chooseClaim(context: AiDecisionContext): ClaimResponse
```

AI 必須共用正式規則引擎，不能自行生成不合法動作。線上 AI 由伺服器觸發；AI 思考超時使用安全預設（過牌或合法棄牌）。記錄模型版本及決策摘要，供問題回放，但不可把私人牌資訊寫入公開事件。

## 8. 線上同步與安全

### 8.1 動作流程

1. 客戶端訂閱所屬房間的 Realtime 公開事件，僅用於接收變更通知與公開狀態。
2. 玩家將 `GameAction`、`roundId`、`expectedEventSeq`、冪等 `requestId` 傳給 Edge Function。
3. 伺服器驗證登入身分與座位，從 DB 讀取權威狀態，執行相同 TypeScript 引擎或呼叫封裝好的伺服器模組，再於單一交易中寫入新狀態與事件。
4. 伺服器回傳呼叫者的 `PublicGameState`。Realtime 通知其他玩家重新取得各自安全投影。
5. 重連時以最後確認的事件序號抓取缺少事件；若事件已清理，從最新快照恢復。

遊戲動作不可由前端直接修改資料列。伺服器端以 `requestId` 去重，避免網路重送導致重複摸牌／加分；以版本比較避免兩個請求同時成功。房間邀請碼使用高熵隨機值、設定到期時間與加入速率限制。

### 8.2 斷線處理

- 短暫斷線保留座位並顯示重連中；恢復後載入最新狀態與缺少事件。
- 房主或真人離線超過可設定寬限期後，房間可設定為暫停、由 AI 接管或結束；預設線上對局保留 60 秒，之後由房間規則決定。
- 已提交的回應不可因重新連線重複套用；所有事件依遞增 `seq` 驗證。

## 9. 測試策略與驗收標準

### 9.1 規則引擎單元測試

- 牌組 56 枚、14 種牌面各 4 枚；洗牌不遺失、不重複牌 ID。
- 發牌座位與手牌數正確，莊家先打；2、3、4 人各有合法牌牆數。
- 所有合法順子／非法跨色順子、卒兵不可順；刻、槓、眼都需同一牌面。
- 胡牌成功／失敗組合、含公開面子、槓補牌、聽牌等待牌及特殊牌型案例。
- 動作階段、牌權、回應優先級、同順位座位距離及逾時處理。
- 計分互斥項目、台數加總、莊家連莊倍率、零和結算及流局。
- 同一種子及事件序列可重現相同的洗牌和狀態；不合法或重複動作不改變狀態。

### 9.2 整合與端對端

- Supabase 本機環境測試 Auth、RLS、房間建立／加入／離開、房主權限、動作 RPC、事件序號及重連恢復。
- Playwright 測試桌面、iPhone 尺寸、iPad 尺寸、Android 常見尺寸：建立單機局、完成摸打、回應碰／胡、顯示結算、重連恢復。
- 觸控及鍵盤操作、牌面縮放、色弱模式、窄螢幕不溢位、載入／錯誤／斷線狀態均納入驗收。
- 效能目標：首屏主要互動可在一般行動網路下快速載入；單一規則判斷在一般裝置上不造成可感知卡頓；AI 普通難度每步於 500 ms 內完成。實際數值於原型階段以裝置量測調整。

### 9.3 發布阻擋條件

- 任何非法狀態可由客戶端寫入資料庫。
- 線上玩家可以從 API／Realtime payload 推知他人暗牌或剩餘牌牆順序。
- 胡牌判斷或結算在支援平台間結果不同。
- 失去連線後可重複得分、重複摸牌或回到不一致局面。
- 主要操作只在桌面或只在單一瀏覽器可用。

## 10. 里程碑與交付物

| 階段 | 預估 | 交付物與完成條件 |
|---|---:|---|
| M0 規則鎖定與原型 | 1 週 | 56 子 `RuleSet`、牌型與計分例表；手機／桌面可點擊線框原型；確認 2–3 人局及槓、聽牌細則 |
| M1 領域引擎 | 1–2 週 | 牌組、發牌、動作狀態機、胡牌判斷、聽牌、計分、事件回放；單元測試案例通過 |
| M2 單機與 AI | 1–2 週 | 響應式牌桌、教學流程、1–3 AI、結果頁、設定；可完成完整離線牌局 |
| M3 Supabase 多人 | 2 週 | Auth、房間、RLS、伺服器權威動作、Realtime 通知、逾時、斷線重連；2–4 座位對局穩定 |
| M4 品質與 PWA | 1–2 週 | 多尺寸視覺修正、無障礙、安裝提示、錯誤追蹤、端對端驗收、上線環境設定 |
| M5 上線與擴充 | 持續 | 監控、規則版本管理、回放及戰績；再評估 32／64 子規則、觀戰或 Capacitor |

估時以 1–2 位工程師且規則確認及時為前提；視覺設計、音效、美術、商店審核與營運工作需另行排程。

## 11. 開發順序與決策清單

1. 先完成純 TypeScript 引擎及桌面／手機可用的單機原型，讓規則在 UI 前可獨立驗證。
2. 與預期玩家確認 56 子玩法：2–3 人局是否接受同牌牆設定、胡牌台數、特殊牌型、暗槓是否算門清、多人同時胡牌、連莊及流局結算。
3. 固定規則版本與 hash，再建 Supabase schema 和 RLS；確認每個 API 回傳內容不含隱藏資訊。
4. 加入 AI；先以進張數策略讓遊戲可玩，再逐步增加風險判斷。
5. 接入線上房間、逾時回應、重連及回放；以事件序號及冪等請求處理競態。
6. 完成行動裝置驗收、PWA 安裝、監控及部署文件。

## 12. 參考資料

- [Google Play：象棋麻將56張](https://play.google.com/store/apps/details?hl=zh_TW&id=com.joechou.chessmj56)：其遊戲說明列出 56 枚牌、莊家 8 張、其他玩家 7 張、順子／刻子／槓子加一對，以及計分牌型。此為單一遊戲版本的規則參考。
- [維基百科：象棋麻將](https://zh.wikipedia.org/wiki/%E8%B1%A1%E6%A3%8B%E9%BA%BB%E5%B0%87)：整理 32、56、64 子等不同牌組與規則差異。作為變體概覽，不視為統一競賽規則。

