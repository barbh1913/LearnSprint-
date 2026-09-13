# 0013 — The content-intelligence pipeline: AI understands, LearnSprint decides

Builds on the extraction of [ADR 0004](0004-feature-based-backend-organization.md)'s `content_topics` feature and the task model of [ADR 0012](0012-topic-as-the-task.md). Replaces the per-student "bring your own key" of FR2.7.

## Context

The original FR2.7 let a student paste their own Anthropic key to get AI topic extraction. For a graded demo that is a trap: the one feature that shows the system understanding material is off by default and fails silently for anyone who did not set it up. Bar decided to remove it and make AI a capability of the backend.

At the same time, the material flows grew beyond "upload a pile of decks once": a single lecture file arrives later and has to land on the right topic; a syllabus should become a lecture-level backlog; attaching new material should refresh a topic without wiping the student's progress. The question was how much of that the AI should decide.

## Decision

**One backend-managed key; a strict split between understanding and deciding.**

- **AI is a system capability.** `SYSTEM_ANTHROPIC_API_KEY` is an environment variable of the `content_topics` Lambda (the same way every other backend setting is configured), read from `shared/config.py`, never returned by any endpoint, never logged. No per-student settings, no key in the browser, nothing in DynamoDB. If the variable is empty or a call fails, the keyword heuristic runs — the same graceful degrade the batch upload always had.
- **The AI only understands unstructured content.** Two content-understanding calls exist next to the batch extractor: `understand_material` (one file → title, summary, key points, topics, an estimated study time) and `propose_lecture_structure` (a syllabus → lecture-level proposals, each with the same fields). Neither is shown a topic id, and neither returns one.
- **LearnSprint decides, deterministically and in words.** `domain/material_matching.py` compares the understood content with the course's existing topics using two explainable signals — how similar the content's title is to a topic's name, and how many of its key points and topics overlap with the topic's name and description, after case-folding, punctuation stripping and Unicode normalisation so Hebrew and English compare the same way. The best score becomes the recommendation with a confidence and a reason sentence ("shares 3 of 5 key points with 'Graphs': BFS, DFS, Dijkstra"), the next two become alternatives, and below a threshold the recommendation is "create a new topic". The matcher runs on heuristic output exactly as on AI output — only the input quality changes.
- **The student confirms; confirmation is idempotent.** Analysis stores the file and its understanding on a `Material` row with no topic. Confirmation files it: attach to a topic, or create one through the same `create_topic` the batch upload uses (three actions, estimated time split by the same rule). A material that already has a topic returns that result again; a "create" that already produced a topic with that normalised name returns that topic; a syllabus records `confirmedAt` and what it created. No second topic, no double attachment, no extra infrastructure.
- **Attaching refreshes, never resets.** Filing material under an existing topic rewrites the topic's description from the new summary and key points. Status, mastery and completed subtasks live on the student's private progress rows and are not touched — the subtasks are not regenerated, so there is nothing to reconcile.
- **Nothing new in the architecture.** Same Lambda, same table, same bucket, plain `httpx`-free Anthropic SDK calls that already existed, synchronous requests — a single-file analysis is strictly lighter than the fifteen-file batch that already runs this way.

## Alternatives considered

- **Keep BYOK and add a default key as fallback.** Two code paths, two failure modes, and a settings card that mostly confuses. Removed instead.
- **Let the AI pick the topic id.** One call fewer, but the decision becomes a black box the project could not defend, and a model can return an id that was never in scope. Keeping the choice in a fifty-line, unit-tested function is the whole point of the academic separation.
- **Embeddings and a vector store for matching.** Better recall at scale, and wildly out of proportion for a course with a few dozen topics. Keyword and title overlap is explainable to a grader in one sentence.
- **Regenerate subtasks when material is attached.** Would need a reconciliation strategy for progress the student already made. Refreshing only the description keeps every progress row untouched by construction.
- **Asynchronous analysis.** Same reasoning as ADR 0009: the request is short enough, and polling would be real complexity for no demonstrated need.

## Consequences

- One manual step: set `SYSTEM_ANTHROPIC_API_KEY` on `learnsprint-content-topics` (and in the local `.env`), with a spending limit on the key — it now serves every upload, not only opted-in students. The `/ai-settings` routes are dead and can be removed from API Gateway.
- Four new routes on the same function: analyse and confirm, for a single material and for a syllabus.
- `Material` gains `analysis` and `confirmedAt`, and `topicId` becomes nullable while a file waits for the student's decision.
- The matcher's weights and threshold are constants in one file and can be tuned without touching the AI or the endpoints.
