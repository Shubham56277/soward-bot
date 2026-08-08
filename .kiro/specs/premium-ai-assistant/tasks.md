# Implementation Plan: Premium AI Assistant

## Overview

This plan implements the RAG-powered Premium AI Assistant by building five new service modules (KnowledgeBase, ToolExecutor, RagService, ResponseFormatter, AnalyticsRecorder), then integrating them into the existing `/ai` command and `@Elfaria` mention handler. Each task builds incrementally — core data structures first, then retrieval logic, tool calling, orchestration, formatting, analytics, and finally integration with the existing bot infrastructure.

## Tasks

- [x] 1. Create KnowledgeBase service with TF-IDF index
  - [x] 1.1 Create `apps/bot/src/service/knowledgeBase.ts` with document types, TF-IDF index, and search
    - Define `KnowledgeDocument`, `CommandDoc`, `ModuleDoc`, `FaqDoc` interfaces
    - Define `SearchResult`, `KnowledgeBaseConfig` interfaces
    - Implement `KnowledgeBase` class with in-memory TF-IDF index (df, tf vectors, idf precomputation)
    - Implement `rebuild(commands, categories)` method that indexes all commands from the registry including name, description, usage, examples, permissions, category, subcommands, keywords, aliases
    - Implement `search(query, maxResults?)` that tokenizes, computes TF-IDF cosine similarity, and returns scored results ordered by descending relevance
    - Implement `getDocument(id)`, `getByCategory(category)`, and `size` getter
    - Add Redis cache integration for query results with configurable TTL (default 300s)
    - Add cache invalidation method `invalidateCache()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1, 9.2, 9.4, 12.1, 12.2, 12.3_

  - [ ]* 1.2 Write property test for KB indexing completeness
    - **Property 1: Knowledge Base indexing completeness**
    - Generate random `CommandRegistryEntry` arrays; after rebuild, every command is retrievable by name with all required metadata fields
    - **Validates: Requirements 2.1, 2.4, 12.1, 12.3**

  - [ ]* 1.3 Write property test for search returning bounded scored results
    - **Property 2: Search returns bounded scored results**
    - Generate random query strings against a populated KB; verify 0 to maxResults documents returned, each with score in [0.0, 1.0], ordered descending
    - **Validates: Requirements 2.5, 2.6, 3.1**

  - [ ]* 1.4 Write property test for keyword and alias resolution
    - **Property 3: Keyword and alias resolution**
    - Pick random commands with keywords/aliases; search by each keyword/alias returns the canonical command
    - **Validates: Requirements 2.5, 16.3**

- [x] 2. Create ToolExecutor service with guild isolation and sanitization
  - [x] 2.1 Create `apps/bot/src/service/toolExecutor.ts` with 6 tools and security enforcement
    - Define `ToolCallRequest`, `ToolCallResult`, `ToolContext` interfaces
    - Implement `ToolExecutor` class with constructor accepting `KnowledgeBase` and `Redis`
    - Implement `execute(call, context)` method with a switch on tool name dispatching to handlers:
      - `search_commands`: searches KB by keyword, returns command summaries
      - `search_documentation`: searches module docs and FAQs by topic
      - `get_command_details`: returns full CommandDoc for a specific command name
      - `get_module_info`: returns ModuleDoc for a module key
      - `get_guild_config`: fetches guild's enabled modules/settings from Redis/DB scoped to `context.guildId`
      - `check_permissions`: checks if a user can execute a command in the guild
    - Enforce guild isolation: reject any `get_guild_config` call attempting a different guild_id
    - Implement `sanitize(output)` to remove fields matching sensitive patterns (api_key, token, secret, password, connection_string, dsn, authorization)
    - Return safe fallback on tool errors with logging
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 7.1, 7.4, 13.6_

  - [ ]* 2.2 Write property test for guild data isolation
    - **Property 5: Guild data isolation**
    - Generate random guild_id pairs; verify tool executor only returns data scoped to requesting guild_id and rejects mismatched guild_ids
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 2.3 Write property test for sensitive data sanitization
    - **Property 6: Sensitive data sanitization**
    - Generate random objects with injected sensitive fields (API keys, tokens, connection strings); verify sanitized output contains none of the original sensitive values
    - **Validates: Requirements 7.1, 7.2, 7.4**

- [x] 3. Create ResponseFormatter service for Discord output
  - [x] 3.1 Create `apps/bot/src/service/responseFormatter.ts` with formatting and message splitting
    - Define `FormattedResponse` interface with `chunks: string[]` and `hasRelatedCommands: boolean`
    - Implement `ResponseFormatter` class with:
      - `formatCommandResponse(text, command?)`: formats a response including command name as heading, description, usage in code block, example in code block, permissions
      - `formatCommandBlock(doc)`: builds structured Discord markdown block from a CommandDoc
      - `splitMessage(text, maxLength = 2000)`: splits text at natural boundaries (double newline > single newline > space) preserving markdown formatting, ensuring each chunk ≤ 2000 chars
    - Append "Related Commands" section (up to 3) when applicable
    - _Requirements: 5.3, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 3.2 Write property test for command response formatting completeness
    - **Property 7: Command response formatting completeness**
    - Generate random CommandDoc objects; verify formatted output contains command name, description, usage in code block, at least one example in code block, and permissions
    - **Validates: Requirements 5.3, 8.1**

  - [ ]* 3.3 Write property test for message splitting preserving validity
    - **Property 8: Message splitting preserves validity**
    - Generate random strings of varying lengths; verify all chunks ≤ 2000 chars and concatenation equals original content (with whitespace normalization)
    - **Validates: Requirements 8.3, 8.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create AnalyticsRecorder service
  - [x] 5.1 Create `apps/bot/src/service/analyticsRecorder.ts` with Redis-backed metrics
    - Define `AnalyticsEvent` interface with fields: timestamp, guildId, userId, queryCategory, responseLatencyMs, provider, cacheHit, documentsRetrieved, toolCallsUsed, escalationRounds
    - Implement `AnalyticsRecorder` class with constructor accepting `Redis`
    - Implement `record(event)`: increment daily query counter (`ai:analytics:queries:{YYYY-MM-DD}`), push latency sample, increment top-commands sorted set, increment top-topics sorted set, set TTLs (48h)
    - Implement `recordError()`: increment daily error counter
    - Implement `getTopCommands(hours, limit)`: read sorted set for top queried commands
    - Implement `getMetrics()`: return totalQueries, errorRate, avgLatencyMs from Redis counters/lists
    - _Requirements: 13.5, 14.1, 14.2, 14.3_

  - [ ]* 5.2 Write property test for analytics event completeness
    - **Property 12: Analytics event completeness**
    - Generate random analytics events; verify all required fields are present in recorded data
    - **Validates: Requirements 13.5, 14.1**

- [x] 6. Create RagService orchestration layer
  - [x] 6.1 Create `apps/bot/src/service/ragService.ts` with RAG pipeline orchestration
    - Define `RagQuery`, `RagResult`, `ToolDefinition` interfaces
    - Define the RAG system prompt (≤ 500 tokens) as a constant
    - Define `TOOL_DEFINITIONS` array with all 6 tool schemas for Groq function calling
    - Implement `RagService` class with constructor accepting `AiService`, `KnowledgeBase`, `Redis`, `AnalyticsRecorder`
    - Implement `ask(query)` method orchestrating the full RAG pipeline:
      1. Normalize query (lowercase, strip mentions, trim)
      2. Check rate limits (per-user and per-guild via existing AiService patterns)
      3. Check concurrency limit; return `{ ok: false, reason: "busy" }` if exceeded
      4. Retrieve 3–5 documents from KnowledgeBase
      5. If all scores below confidence threshold (0.15), perform second retrieval with reformulated terms
      6. Build LLM messages: system prompt + retrieved doc context + conversation history (max 10 messages) + user question
      7. Call Groq via `openAiCompatible` with tool definitions
      8. Handle tool_call responses: execute via ToolExecutor, feed results back (max 2 escalation rounds)
      9. Format final response via ResponseFormatter
      10. Record analytics
    - Implement `getToolDefinitions()` returning the tool array
    - Expose private helper for Groq tool-calling request (extends existing `openAiCompatible` pattern with `tools` parameter)
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4, 4.7, 5.1, 5.2, 5.4, 6.3, 6.4, 7.2, 7.3, 9.2, 9.3, 10.1, 10.2, 10.3, 11.1, 11.2, 13.1, 13.2, 13.3, 13.4, 15.1, 15.2, 15.3, 16.1, 16.2, 16.4, 17.1, 17.2, 17.3, 17.4_

  - [ ]* 6.2 Write property test for confidence-based retrieval escalation bound
    - **Property 4: Confidence-based retrieval escalation is bounded**
    - Mock low-confidence results; verify RAG pipeline performs at most 2 additional retrieval rounds
    - **Validates: Requirements 3.3, 15.2**

  - [ ]* 6.3 Write property test for conversation history truncation
    - **Property 9: Conversation history truncation**
    - Generate histories of length 0–50; verify LLM request includes at most 10 messages
    - **Validates: Requirements 10.3**

  - [ ]* 6.4 Write property test for concurrency limit enforcement
    - **Property 13: Concurrency limit enforcement**
    - Set active request count to max; verify next request returns `{ ok: false, reason: "busy" }` with positive retryAfter
    - **Validates: Requirements 11.2**

  - [ ]* 6.5 Write property test for tool definitions in LLM requests
    - **Property 14: Tool definitions included in LLM requests**
    - Generate random query contexts; verify LLM request payload includes all registered tool definitions with name, description, and parameter schemas
    - **Validates: Requirements 17.2**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integrate RAG into existing Ai.ts command and messageCreate.ts
  - [x] 8.1 Wire KnowledgeBase rebuild into bot startup and integrate RagService into client
    - In the bot's client initialization (where `client.ai` is set up), instantiate `KnowledgeBase`, `AnalyticsRecorder`, `ToolExecutor`, `ResponseFormatter`, and `RagService`
    - Call `knowledgeBase.rebuild(client.commands, helpArchitecture.categories)` after commands are loaded
    - Expose `client.rag` (or attach to existing `client.ai`) for command/event access
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 8.2 Update `apps/bot/src/commands/premium/Ai.ts` to route through RagService
    - In the `ask` action, call `client.rag.ask(...)` instead of `client.ai.ask(...)` for RAG-augmented responses
    - Keep `start`, `stop`, `reset`, `status` subcommands unchanged (they use session management on the existing AiService)
    - Update `sendResult` to handle the new `RagResult` shape (documentsRetrieved, toolCallsUsed fields)
    - Use `ResponseFormatter.splitMessage()` for splitting long responses
    - _Requirements: 1.2, 8.3, 8.4_

  - [x] 8.3 Update `apps/bot/src/events/client/messageCreate.ts` to route mentions and sessions through RagService
    - In the `@Elfaria mention` handler (where `wasMentioned && !isKnownCommand` triggers AI), call `client.rag.ask(...)` instead of `client.ai.ask(...)`
    - In the `activeAiSession` path, call `client.rag.ask(...)` for RAG-augmented session messages
    - Keep the premium check and session control logic unchanged
    - Update `sendAiMessageResult` to handle `RagResult` type
    - _Requirements: 1.1, 1.3, 1.4_

  - [ ]* 8.4 Write property tests for rate limiting enforcement
    - **Property 10: Per-user rate limiting enforcement**
    - Simulate user making exactly `AI_USER_REQUESTS_PER_MINUTE` requests; verify next is rejected with "rate_limited" and positive retryAfter
    - **Property 11: Per-guild rate limiting enforcement**
    - Simulate guild making exactly `AI_GUILD_REQUESTS_PER_MINUTE` requests; verify next is rejected with "rate_limited" and positive retryAfter
    - **Validates: Requirements 13.1, 13.2**

- [x] 9. Build verification and smoke tests
  - [x] 9.1 Verify TypeScript compilation and build with `yarn bot:build`
    - Run `tsup` build via `yarn bot:build`; ensure zero type errors
    - Verify all new service files are included in the bundle
    - Verify no circular imports between KnowledgeBase, ToolExecutor, RagService, ResponseFormatter, AnalyticsRecorder
    - _Requirements: 11.3, 12.1_

  - [ ]* 9.2 Write smoke test for KB rebuild and system prompt token count
    - Verify KnowledgeBase rebuilds with >0 documents from a mock command registry
    - Verify the RAG system prompt is ≤ 500 tokens (count with a simple whitespace tokenizer or tiktoken)
    - _Requirements: 10.1, 12.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `AiService` is NOT modified — `RagService` composes it
- All new services go in `apps/bot/src/service/`
- Redis keys follow the schema defined in the design document
- The Groq provider's `openAiCompatible` pattern is extended with `tools` parameter for function calling

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1", "3.2", "3.3", "5.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "6.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
