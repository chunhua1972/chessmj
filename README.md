# 將士象｜象棋麻將

Vite、React、TypeScript 與 Supabase 的象棋麻將遊戲。包含離線練習、電子郵件登入、線上房間、真人／AI 座位、即時同步及伺服器驗證的牌局動作。

## 本機啟動

```sh
npm install
```

複製 `.env.example` 為 `.env.local`，填入 Supabase Project URL 和公開 anon key，再執行：

```sh
npm run dev
```

`.env.local`、`.env` 及 Supabase CLI 暫存檔已加入 `.gitignore`。`service_role` key、資料庫密碼和 Supabase secret 只可放在 Supabase Edge Function Secrets，不可放入 `VITE_*` 變數或提交到 GitHub。

## 指令

```sh
npm test
npm run build
```

線上房間 schema 僅建立 `chessmj_*` 資料表。GitHub Pages 由 GitHub Actions 建置與部署；Supabase migrations 和 Edge Functions 以 Supabase CLI 部署。
