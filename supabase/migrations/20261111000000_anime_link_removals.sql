-- A stored anime link taken back ("Use Polarity's match", #335) stays as its row marked
-- deleted, keeping the removed link's ids, so the removal reaches every device by the usual
-- pull. A later link for the entry overwrites the row (sync_lww), deleted or not. Apps from
-- before #335 don't read the column: they keep the link they had.
alter table public.anime_links add column deleted boolean not null default false;
