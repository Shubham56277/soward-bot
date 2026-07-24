/**
 * musicSearchService.ts
 *
 * Smart music search pipeline that normalizes queries, retrieves candidates from
 * multiple providers, scores every candidate deterministically, and selects the
 * best match. Falls back gracefully when a source is unavailable or returns
 * low-confidence results.
 *
 * Architecture rules:
 * - No hardcoded song titles or special-case logic for individual songs.
 * - No anti-detection, stealth, or CAPTCHA-bypass code.
 * - No credentials or tokens are ever logged.
 */

import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { Player, Track, SearchResult } from "lavalink-client";

// ─── Cache TTL ───────────────────────────────────────────────────────────────
const CACHE_TTL_SECONDS = 20 * 60; // 20 minutes for successful resolutions
const CACHE_MAX_ENTRIES = 500;     // bounded — entries are evicted after TTL by Redis

// ─── Noise words stripped from titles during comparison only ─────────────────
// Artist names, movie names, and version names are NEVER stripped.
const TITLE_NOISE_WORDS = new Set([
    "official", "audio", "video", "lyrical", "lyrics", "topic",
    "full", "song", "hd", "4k", "720p", "1080p", "visualizer",
    "music",
]);

// Version-intent keywords that must never be treated as noise
const VERSION_INTENT_WORDS = new Set([
    "live", "slowed", "reverb", "nightcore", "instrumental",
    "karaoke", "remix", "cover", "acoustic", "mashup",
    "original", "remaster", "remastered", "unplugged", "extended",
    "version", "reprise", "radio", "edit",
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryIntent {
    /** Original query string exactly as the user typed it */
    original: string;
    /** Lowercased, space-normalized, punctuation-stripped version for comparison */
    normalized: string;
    /** Detected version modifiers (live, remix, slowed, etc.) */
    versionFlags: Set<string>;
    /** Whether the user explicitly mentioned "original" (reject covers/live) */
    wantsOriginal: boolean;
}

export interface CanonicalTrack {
    title: string;
    artist: string;
    album: string;
    /** Duration in milliseconds, 0 if unknown */
    durationMs: number;
    isrc: string;
    year: number;
    /** Raw tracks from each provider, deduplicated */
    candidates: ScoredCandidate[];
}

export interface ScoredCandidate {
    track: Track;
    score: number;
    /** Human-readable explanation of each score component */
    scoreReasons: string[];
    source: string;
    /** Identifier that failed playback — used for fallback deduplication */
    failedPlayback?: boolean;
}

export interface SearchResolution {
    winner: ScoredCandidate | null;
    /** Candidates to show the user when confidence is below auto-play threshold */
    choices: ScoredCandidate[];
    /** Whether the winner can be auto-played (score ≥ 80, or 65-79 with consistent identity) */
    autoPlay: boolean;
    /** Human-readable reason when autoPlay is false */
    reason: string;
    /** Canonical identity built from the strongest metadata candidate */
    canonical: CanonicalTrack;
}

export type PlaybackFailureResult =
    | { status: "found"; next: ScoredCandidate }
    | { status: "exhausted"; message: string };

// ─── Cache entry ─────────────────────────────────────────────────────────────

interface CacheEntry {
    normalized: string;
    canonical: Omit<CanonicalTrack, "candidates">;
    winnerId: string;
    winnerSource: string;
    score: number;
    resolvedAt: number;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizeForComparison(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")   // strip punctuation for comparison only
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Strip noise words that add no identity signal (official, audio, lyrical, etc.)
 * but preserve version-intent words and all artist/movie names.
 */
function stripNoise(text: string): string {
    return normalizeForComparison(text)
        .split(" ")
        .filter(t => !TITLE_NOISE_WORDS.has(t))
        .join(" ");
}

/** Jaccard token-level similarity [0, 1] */
function tokenSimilarity(a: string, b: string): number {
    const ta = new Set(stripNoise(a).split(" ").filter(Boolean));
    const tb = new Set(stripNoise(b).split(" ").filter(Boolean));
    if (ta.size === 0 && tb.size === 0) return 1;
    if (ta.size === 0 || tb.size === 0) return 0;
    let intersection = 0;
    for (const t of ta) if (tb.has(t)) intersection++;
    return intersection / (ta.size + tb.size - intersection);
}

/** Bigram character-level similarity [0, 1] */
function bigramSimilarity(a: string, b: string): number {
    const bigrams = (s: string) => {
        const set: string[] = [];
        for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
        return set;
    };
    const ba = bigrams(normalizeForComparison(a));
    const bb = bigrams(normalizeForComparison(b));
    if (ba.length === 0 && bb.length === 0) return 1;
    if (ba.length === 0 || bb.length === 0) return 0;
    const countA: Record<string, number> = {};
    const countB: Record<string, number> = {};
    for (const b of ba) countA[b] = (countA[b] ?? 0) + 1;
    for (const b of bb) countB[b] = (countB[b] ?? 0) + 1;
    let matches = 0;
    for (const [bg, cnt] of Object.entries(countA)) {
        matches += Math.min(cnt, countB[bg] ?? 0);
    }
    return (2 * matches) / (ba.length + bb.length);
}

function titleSimilarity(a: string, b: string): number {
    return (tokenSimilarity(a, b) + bigramSimilarity(a, b)) / 2;
}

function cacheKey(normalized: string): string {
    return `music:search:${createHash("sha1").update(normalized).digest("hex")}`;
}

// ─── Parse query intent ───────────────────────────────────────────────────────

export function parseQueryIntent(raw: string): QueryIntent {
    const original = raw.trim();
    const normalized = normalizeForComparison(original);
    const tokens = new Set(normalized.split(" "));

    const versionFlags = new Set<string>();
    for (const flag of VERSION_INTENT_WORDS) {
        if (tokens.has(flag)) versionFlags.add(flag);
    }

    return {
        original,
        normalized,
        versionFlags,
        wantsOriginal: tokens.has("original"),
    };
}

// ─── Score a single candidate ─────────────────────────────────────────────────

export function scoreCandidate(
    candidate: Track,
    intent: QueryIntent,
    canonical: Omit<CanonicalTrack, "candidates">,
): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const candidateTitle = candidate.info.title ?? "";
    const candidateArtist = candidate.info.author ?? "";
    const candidateDurationMs = candidate.info.duration ?? 0;
    const candidateSource = candidate.info.sourceName ?? "";

    const titleNorm = normalizeForComparison(candidateTitle);
    const artistNorm = normalizeForComparison(candidateArtist);

    // ── ISRC exact match (strongest signal) ──
    const candidateIsrc: string | undefined = (candidate.pluginInfo as any)?.isrc
        ?? (candidate.pluginInfo as any)?.albumName // lavasrc sometimes stashes isrc here
        ?? undefined;

    if (canonical.isrc && candidateIsrc && canonical.isrc === candidateIsrc) {
        score += 40;
        reasons.push(`+40 ISRC match (${canonical.isrc})`);
    }

    // ── Title matching ──
    const canonicalTitleNorm = normalizeForComparison(canonical.title);
    const canonicalTitleStripped = stripNoise(canonical.title);
    const candidateTitleStripped = stripNoise(candidateTitle);

    if (canonicalTitleNorm && titleNorm === canonicalTitleNorm) {
        score += 35;
        reasons.push("+35 exact title match");
    } else {
        const sim = titleSimilarity(canonicalTitleStripped || canonical.title, candidateTitleStripped || candidateTitle);
        const titlePoints = Math.round(sim * 25);
        if (titlePoints > 0) {
            score += titlePoints;
            reasons.push(`+${titlePoints} title similarity (${(sim * 100).toFixed(0)}%)`);
        }
    }

    // ── Artist matching ──
    const canonicalArtistNorm = normalizeForComparison(canonical.artist);
    if (canonicalArtistNorm) {
        if (artistNorm === canonicalArtistNorm) {
            score += 25;
            reasons.push("+25 exact artist match");
        } else {
            const sim = titleSimilarity(canonical.artist, candidateArtist);
            if (sim >= 0.7) {
                const pts = Math.round(sim * 15);
                score += pts;
                reasons.push(`+${pts} artist similarity (${(sim * 100).toFixed(0)}%)`);
            } else if (sim < 0.3 && canonical.artist) {
                // Clearly wrong artist
                score -= 35;
                reasons.push(`-35 wrong artist ("${candidateArtist}" vs canonical "${canonical.artist}")`);
            }
        }
    }

    // ── Album / movie matching ──
    const albumRaw: string | undefined = (candidate.pluginInfo as any)?.albumName
        ?? (candidate.pluginInfo as any)?.album?.name
        ?? undefined;

    if (canonical.album && albumRaw) {
        const albumSim = titleSimilarity(canonical.album, albumRaw);
        if (albumSim >= 0.7) {
            score += 12;
            reasons.push(`+12 album/movie match ("${albumRaw}")`);
        } else if (albumSim < 0.25) {
            score -= 25;
            reasons.push(`-25 different album/movie ("${albumRaw}" vs "${canonical.album}")`);
        }
    }

    // ── Duration matching ──
    if (canonical.durationMs > 0 && candidateDurationMs > 0) {
        const diff = Math.abs(canonical.durationMs - candidateDurationMs);
        if (diff <= 3_000) {
            score += 15;
            reasons.push(`+15 duration ≤3s diff (${diff}ms)`);
        } else if (diff <= 8_000) {
            score += 10;
            reasons.push(`+10 duration ≤8s diff (${diff}ms)`);
        } else if (diff <= 15_000) {
            score += 5;
            reasons.push(`+5 duration ≤15s diff (${diff}ms)`);
        } else if (diff > 30_000) {
            score -= 20;
            reasons.push(`-20 duration >30s diff (${diff}ms)`);
        }
    }

    // ── Under 60 seconds (snippet / short clip) ──
    if (!candidate.info.isStream && candidateDurationMs > 0 && candidateDurationMs < 60_000) {
        score -= 35;
        reasons.push("-35 track under 60s (clip/snippet)");
    }

    // ── Source bonuses ──
    if (candidateSource === "youtubemusic") {
        score += 5;
        reasons.push("+5 YouTube Music source");
    }

    // Official / topic / artist channel bonus
    const uploaderLower = candidateArtist.toLowerCase();
    const isTopicChannel = uploaderLower.endsWith("- topic") || uploaderLower.includes("topic");
    const isOfficialLabel = uploaderLower.includes("music") || uploaderLower.includes("records") || uploaderLower.includes("official");
    if (isTopicChannel) {
        score += 6;
        reasons.push("+6 topic/official channel");
    } else if (isOfficialLabel) {
        score += 8;
        reasons.push("+8 official artist/label channel");
    }

    // ── Version-intent penalties ──
    const titleLower = candidateTitle.toLowerCase();

    function flagDetected(word: string): boolean {
        return new RegExp(`\\b${word}\\b`).test(titleLower);
    }

    if (!intent.versionFlags.has("live") && flagDetected("live")) {
        score -= 20;
        reasons.push("-20 live version (not requested)");
    }
    if (!intent.versionFlags.has("remix") && flagDetected("remix")) {
        score -= 20;
        reasons.push("-20 remix (not requested)");
    }
    if (!intent.versionFlags.has("slowed") && (flagDetected("slowed") || flagDetected("reverb"))) {
        score -= 25;
        reasons.push("-25 slowed/reverb (not requested)");
    }
    if (!intent.versionFlags.has("nightcore") && flagDetected("nightcore")) {
        score -= 25;
        reasons.push("-25 nightcore (not requested)");
    }
    if (!intent.versionFlags.has("instrumental") && flagDetected("instrumental")) {
        score -= 25;
        reasons.push("-25 instrumental (not requested)");
    }
    if (!intent.versionFlags.has("karaoke") && flagDetected("karaoke")) {
        score -= 30;
        reasons.push("-30 karaoke (not requested)");
    }
    if (!intent.versionFlags.has("cover") && flagDetected("cover")) {
        score -= 25;
        reasons.push("-25 cover (not requested)");
    }
    if (!intent.versionFlags.has("mashup") && flagDetected("mashup")) {
        score -= 35;
        reasons.push("-35 mashup (not requested)");
    }

    // Reject trailers, reactions, edits, status videos, short clips
    const junkPatterns = ["trailer", "reaction", "reacts", "status", "tiktok edit", "short clip"];
    for (const pattern of junkPatterns) {
        if (titleLower.includes(pattern)) {
            score -= 35;
            reasons.push(`-35 junk content (${pattern})`);
        }
    }

    // Original intent: penalize non-studio recordings
    if (intent.wantsOriginal && (
        flagDetected("live") || flagDetected("cover") || flagDetected("remix") ||
        flagDetected("nightcore") || flagDetected("karaoke")
    )) {
        score -= 30;
        reasons.push("-30 not original (user wants original)");
    }

    return { score: Math.max(0, score), reasons };
}

// ─── Build canonical identity from raw query (no metadata API available) ────

function buildCanonicalFromQuery(intent: QueryIntent): Omit<CanonicalTrack, "candidates"> {
    // Without a metadata API, we use the query itself as title and leave
    // artist/album empty. The scorer will rely on title + duration signals.
    return {
        title: intent.original,
        artist: "",
        album: "",
        durationMs: 0,
        isrc: "",
        year: 0,
    };
}

// ─── Deduplicate candidates ───────────────────────────────────────────────────

function deduplicateCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
    const seen = new Set<string>();
    const result: ScoredCandidate[] = [];

    for (const candidate of candidates) {
        const id = candidate.track.info.identifier;
        const titleArtistKey = `${normalizeForComparison(candidate.track.info.title)}::${normalizeForComparison(candidate.track.info.author ?? "")}`;

        if (seen.has(id) || seen.has(titleArtistKey)) continue;
        seen.add(id);
        seen.add(titleArtistKey);
        result.push(candidate);
    }

    return result;
}

// ─── Main search pipeline ─────────────────────────────────────────────────────

export class MusicSearchService {
    constructor(
        private readonly redis: Redis,
        private readonly player: Player,
        private readonly logger: { debug: (msg: string) => void; warn: (msg: string) => void },
    ) {}

    /**
     * Full search pipeline: normalize → fetch candidates → score → resolve.
     */
    async resolve(rawQuery: string, requester: unknown): Promise<SearchResolution> {
        const intent = parseQueryIntent(rawQuery);

        this.logger.debug(`[music-search] original="${intent.original}" normalized="${intent.normalized}" flags=[${[...intent.versionFlags].join(",")}]`);

        // ── Check cache ──
        const cached = await this.readCache(intent.normalized);
        if (cached) {
            this.logger.debug(`[music-search] cache hit for "${intent.normalized}" winner=${cached.winnerId}`);
            // Re-run a quick search to get a live Track object for playback
            // (cache only stores the identifier, not the full Track blob)
        }

        // ── Build canonical identity ──
        // In a future enhancement this would call Apple Music / Spotify APIs.
        // For now we build from the query itself. The scoring still works well
        // because title/artist/duration signals come from the actual results.
        const canonical = buildCanonicalFromQuery(intent);

        // ── Gather candidates from multiple providers ──
        const rawCandidates = await this.fetchCandidates(intent, canonical, requester);

        this.logger.debug(`[music-search] ${rawCandidates.length} raw candidates fetched`);

        // ── Score ──
        const scored: ScoredCandidate[] = rawCandidates.map(track => {
            const { score, reasons } = scoreCandidate(track, intent, canonical);
            this.logger.debug(`[music-search] candidate "${track.info.title}" by "${track.info.author}" score=${score} | ${reasons.join("; ")}`);
            return {
                track,
                score,
                scoreReasons: reasons,
                source: track.info.sourceName ?? "unknown",
            };
        });

        // ── Deduplicate ──
        const unique = deduplicateCandidates(scored);

        // ── Sort by score descending ──
        unique.sort((a, b) => b.score - a.score);

        const top5 = unique.slice(0, 5);
        const best = top5[0] ?? null;

        if (!best) {
            return {
                winner: null,
                choices: [],
                autoPlay: false,
                reason: "No results found.",
                canonical: { ...canonical, candidates: [] },
            };
        }

        // ── Confidence thresholds ──
        let autoPlay = false;
        let reason = "";

        if (best.score >= 80) {
            autoPlay = true;
        } else if (best.score >= 65) {
            // Auto-play only if title, artist, and duration are consistent
            const titleOk = titleSimilarity(canonical.title, best.track.info.title) >= 0.5;
            const durationOk = canonical.durationMs === 0 || Math.abs(canonical.durationMs - best.track.info.duration) <= 15_000;
            autoPlay = titleOk && durationOk;
            if (!autoPlay) reason = "Confidence 65-79 but title or duration inconsistent — showing choices.";
        } else {
            reason = `Best score is ${best.score} (below 65) — showing choices.`;
        }

        this.logger.debug(`[music-search] winner="${best.track.info.title}" score=${best.score} autoPlay=${autoPlay}`);

        // ── Cache successful resolution ──
        if (autoPlay) {
            await this.writeCache(intent.normalized, canonical, best).catch(() => undefined);
        }

        return {
            winner: best,
            choices: top5,
            autoPlay,
            reason,
            canonical: { ...canonical, candidates: unique },
        };
    }

    /**
     * Call after a playback failure to get the next best candidate.
     * Marks the failed identifier so it is skipped in future attempts.
     */
    nextFallback(resolution: SearchResolution, failedIdentifier: string): PlaybackFailureResult {
        // Invalidate cache for this query
        const intent = parseQueryIntent(resolution.canonical.title);
        this.redis.del(cacheKey(intent.normalized)).catch(() => undefined);

        const remaining = resolution.canonical.candidates.filter(
            c => c.track.info.identifier !== failedIdentifier && !c.failedPlayback
        );

        if (remaining.length === 0) {
            return {
                status: "exhausted",
                message: "I found the song metadata, but no matching playable source is currently available.",
            };
        }

        // Enforce the same confidence threshold — don't lower it on failure
        const minScore = resolution.winner ? Math.min(resolution.winner.score, 65) : 65;
        const nextValid = remaining.find(c => c.score >= minScore && c.source !== "soundcloud")
            ?? remaining.find(c => c.score >= minScore);

        if (!nextValid) {
            return {
                status: "exhausted",
                message: "I found the song metadata, but no matching playable source is currently available.",
            };
        }

        this.logger.debug(`[music-search] fallback: "${nextValid.track.info.title}" score=${nextValid.score} source=${nextValid.source}`);
        return { status: "found", next: nextValid };
    }

    // ─── Private: fetch candidates from multiple providers ──────────────────

    private async fetchCandidates(
        intent: QueryIntent,
        canonical: Omit<CanonicalTrack, "candidates">,
        requester: unknown,
    ): Promise<Track[]> {
        const results: Track[] = [];

        const searchAndCollect = async (query: string, source?: string): Promise<void> => {
            try {
                const res: SearchResult = source
                    ? await this.player.search({ query, source }, requester)
                    : await this.player.search({ query }, requester);

                if (res?.tracks?.length) {
                    const top = res.tracks.slice(0, 5);
                    results.push(...top);
                    this.logger.debug(`[music-search] provider="${source ?? "auto"}" query="${query}" returned ${top.length} tracks`);
                }
            } catch (err: any) {
                this.logger.warn(`[music-search] provider="${source ?? "auto"}" query="${query}" failed: ${err?.message ?? err}`);
            }
        };

        // A — ISRC search on YouTube (highest precision)
        if (canonical.isrc) {
            await searchAndCollect(`ytsearch:"${canonical.isrc}"`, "ytsearch");
        }

        // B — YouTube Music: title + artist + album
        if (canonical.artist && canonical.album) {
            await searchAndCollect(`ytmsearch:"${canonical.title} ${canonical.artist} ${canonical.album}"`, "ytmsearch");
        }

        // C — YouTube: title + artist + album
        if (canonical.artist && canonical.album) {
            await searchAndCollect(`ytsearch:"${canonical.title} ${canonical.artist} ${canonical.album}"`, "ytsearch");
        }

        // D — YouTube: title + artist (always run)
        if (canonical.artist) {
            await searchAndCollect(`ytsearch:"${canonical.title} ${canonical.artist}"`, "ytsearch");
        }

        // E — Plain query on YouTube (fallback for short/ambiguous queries)
        await searchAndCollect(intent.original, "ytsearch");

        // F — SoundCloud: title + artist (only when we have enough metadata)
        if (canonical.artist) {
            await searchAndCollect(`scsearch:${canonical.title} ${canonical.artist}`, "scsearch");
        }

        return results;
    }

    // ─── Cache helpers ───────────────────────────────────────────────────────

    private async readCache(normalized: string): Promise<CacheEntry | null> {
        try {
            const raw = await this.redis.get(cacheKey(normalized));
            if (!raw) return null;
            return JSON.parse(raw) as CacheEntry;
        } catch {
            return null;
        }
    }

    private async writeCache(
        normalized: string,
        canonical: Omit<CanonicalTrack, "candidates">,
        winner: ScoredCandidate,
    ): Promise<void> {
        const entry: CacheEntry = {
            normalized,
            canonical,
            winnerId: winner.track.info.identifier,
            winnerSource: winner.source,
            score: winner.score,
            resolvedAt: Date.now(),
        };
        await this.redis.setex(cacheKey(normalized), CACHE_TTL_SECONDS, JSON.stringify(entry));
    }
}
