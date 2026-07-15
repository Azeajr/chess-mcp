# Chat toolset review history

Historical status: review findings incorporated by Product Review Phases 1–5.

The review identified independently handwritten host contracts, mandatory workflow modes, repeated
full-PGN prompt injection, unsafe argument casts, untyped JSON results, chat-only edit handling, and
missing direct access to primary repertoire analyses. Those findings led to the canonical registry,
runtime browser validation, a complete stable schema on every tool-capable round, scoped document
retrieval, cancellation and progress, typed results, staged revision-bound actions, artifacts, and
shared direct commands. An intermediate capability-routing design was later removed after provider
and model testing favored stable full availability.

The July 2026 credentialed verification exercised the actual browser chat store with all 39 browser
schemas (16,163 UTF-8 JSON bytes) on every tool-capable round. Both configured OpenRouter models,
`deepseek/deepseek-v4-flash` and `openai/gpt-oss-20b:free`, passed all ten selection journeys:
ambiguous repertoire diagnosis, each formerly unreachable repertoire command, position evaluation,
a grounded position follow-up, and repertoire/game document switches within one conversation. The
DeepSeek requests reported roughly 6.3k prompt tokens per initial round and a small nonzero provider
cost; GPT-OSS reported roughly 3.6k–4.2k prompt tokens and zero API cost. Latency varied from a few
seconds into the tens of seconds, so the stable surface is acceptable for selection quality but its
context and tail-latency cost remains a release-candidate measurement concern.

Remaining integration verification is listed in `ROADMAP.md`; current product behavior is in
`docs/PWA_PRODUCT.md`.
