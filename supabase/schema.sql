-- ============================================================
-- 雀成績 Supabase スキーマ
-- 1ユーザー1行に、アプリ状態(店・来店・半荘)を JSONB で丸ごと保存する方式。
-- 統計はクライアント側で計算するため、正規化テーブルは持たない。
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
-- ============================================================

create table if not exists app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 行レベルセキュリティ: 各ユーザーは自分の行だけ読み書き可能
alter table app_state enable row level security;

drop policy if exists "own row select" on app_state;
drop policy if exists "own row insert" on app_state;
drop policy if exists "own row update" on app_state;

create policy "own row select" on app_state
  for select using (auth.uid() = user_id);

create policy "own row insert" on app_state
  for insert with check (auth.uid() = user_id);

create policy "own row update" on app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
