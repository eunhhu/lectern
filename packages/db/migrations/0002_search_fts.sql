-- Full-text index over search_chunk (docs/adr/0009-ask-rag.md, ARCHITECTURE §12).
-- Contentless: the indexed `body` is the bigram form of search_chunk.text that
-- @lectern/ask computes (Korean has no whitespace-delimited morphemes, so Hangul runs
-- are indexed as overlapping character bigrams and Latin/digit runs as whole words).
-- rowid = search_chunk.seq. Rows are written and deleted by @lectern/ask in the same
-- transaction as search_chunk, not by triggers, because the body is computed in code.
-- contentless_delete needs SQLite 3.43+.
CREATE VIRTUAL TABLE `search_chunk_fts` USING fts5(
	body,
	content = '',
	contentless_delete = 1,
	tokenize = 'unicode61 remove_diacritics 0'
);
