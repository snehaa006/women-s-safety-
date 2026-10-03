-- Covers the triage_lexicon.category foreign key (performance advisor).
create index if not exists triage_lexicon_category_idx on private.triage_lexicon (category);
