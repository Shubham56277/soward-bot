/**
 * musicSearchService.test.ts
 *
 * Unit tests for the scoring engine and query parser.
 * These run without a real Lavalink connection — they test the pure logic.
 * Run with: npx tsx --test src/service/musicSearchService.test.ts
 */

import { parseQueryIntent, scoreCandidate, type QueryIntent } from "./musicSearchService";
import type { Track } from "lavalink-client";
import assert from "node:assert";
import { describe, it } from "node:test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrack(overrides: {
    title?: string;
    author?: string;
    duration?: number;
    sourceName?: string;
    identifier?: string;
    isrc?: string;
    albumName?: string;
    uri?: string;
}): Track {
    return {
        info: {
            title: overrides.title ?? "Unknown Title",
            author: overrides.author ?? "Unknown Artist",
            duration: overrides.duration ?? 200_000,
            sourceName: overrides.sourceName ?? "youtube",
            identifier: overrides.identifier ?? "test-id",
            uri: overrides.uri ?? "https://youtube.com/watch?v=test",
            isStream: false,
            isSeekable: true,
            artworkUrl: null,
            isrc: overrides.isrc ?? null,
        },
        pluginInfo: {
            albumName: overrides.albumName ?? undefined,
            isrc: overrides.isrc ?? undefined,
        },
        userData: {},
        encoded: "",
        requester: null,
    } as unknown as Track;
}

function canonical(overrides: {
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    isrc?: string;
}) {
    return {
        title: overrides.title ?? "",
        artist: overrides.artist ?? "",
        album: overrides.album ?? "",
        durationMs: overrides.durationMs ?? 0,
        isrc: overrides.isrc ?? "",
        year: 0,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseQueryIntent", () => {
    it("normalizes lowercase and strips punctuation for comparison", () => {
        const q = parseQueryIntent("Humsafar - Saiyaara!!");
        assert.strictEqual(q.versionFlags.size, 0);
        assert.strictEqual(q.normalized, "humsafar  saiyaara"); // punctuation → space
        assert.strictEqual(q.original, "Humsafar - Saiyaara!!");
    });

    it("detects live flag", () => {
        const q = parseQueryIntent("humsafar live");
        assert.ok(q.versionFlags.has("live"));
    });

    it("detects slowed flag", () => {
        const q = parseQueryIntent("humsafar slowed reverb");
        assert.ok(q.versionFlags.has("slowed"));
        assert.ok(q.versionFlags.has("reverb"));
    });

    it("detects original flag", () => {
        const q = parseQueryIntent("humsafar original");
        assert.ok(q.wantsOriginal);
    });

    it("preserves artist names as part of normalized query", () => {
        const q = parseQueryIntent("Believer Imagine Dragons");
        assert.ok(q.normalized.includes("believer"));
        assert.ok(q.normalized.includes("imagine"));
        assert.ok(q.normalized.includes("dragons"));
    });
});

describe("scoreCandidate — humsafar", () => {
    const intent: QueryIntent = parseQueryIntent("humsafar");
    const can = canonical({ title: "Humsafar", artist: "Sachin-Jigar", album: "Saiyaara", durationMs: 271_000 });

    it("correct artist + album + duration scores high", () => {
        const track = makeTrack({
            title: "Humsafar (Official Audio)",
            author: "Sachin-Jigar",
            duration: 272_000,
            albumName: "Saiyaara",
            sourceName: "youtubemusic",
        });
        const { score } = scoreCandidate(track, intent, can);
        // Expect: +25 title sim + 25 artist + 12 album + 15 duration + 5 ytmusic ≥ 75
        assert.ok(score >= 70, `Score was ${score}, expected ≥70`);
    });

    it("wrong artist scores lower", () => {
        const wrongArtist = makeTrack({
            title: "Humsafar",
            author: "Rahat Fateh Ali Khan",
            duration: 350_000,
        });
        const { score } = scoreCandidate(wrongArtist, intent, can);
        // Wrong artist: -35, duration >30s: -20 → much lower
        assert.ok(score < 40, `Score was ${score}, expected <40`);
    });

    it("live version is penalized when not requested", () => {
        const live = makeTrack({
            title: "Humsafar (Live at Filmfare)",
            author: "Sachin-Jigar",
            duration: 280_000,
            albumName: "Saiyaara",
        });
        const { score, reasons } = scoreCandidate(live, intent, can);
        assert.ok(reasons.some(r => r.includes("live version")), "Expected live penalty");
        // Should score lower than the non-live version
        const clean = makeTrack({
            title: "Humsafar (Official Audio)",
            author: "Sachin-Jigar",
            duration: 272_000,
            albumName: "Saiyaara",
        });
        const cleanScore = scoreCandidate(clean, intent, can).score;
        assert.ok(score < cleanScore, `Live (${score}) should score below clean (${cleanScore})`);
    });

    it("ISRC match adds 40 points", () => {
        const trackWithIsrc = makeTrack({
            title: "Humsafar",
            author: "Sachin-Jigar",
            duration: 271_500,
            isrc: "INXXX2500001",
        });
        const { score } = scoreCandidate(
            trackWithIsrc,
            intent,
            { ...can, isrc: "INXXX2500001" },
        );
        // Should be significantly boosted
        const baseline = scoreCandidate(
            makeTrack({ title: "Humsafar", author: "Sachin-Jigar", duration: 271_500 }),
            intent,
            can,
        ).score;
        assert.ok(score >= baseline + 35, `ISRC match should add ≥35 pts (got +${score - baseline})`);
    });
});

describe("scoreCandidate — humsafar saiyaara", () => {
    const intent = parseQueryIntent("humsafar saiyaara");
    const can = canonical({ title: "Humsafar Saiyaara", artist: "", album: "Saiyaara", durationMs: 271_000 });

    it("Saiyaara album result scores higher than unrelated Humsafar", () => {
        const saiyaara = makeTrack({
            title: "Humsafar - Saiyaara",
            author: "Sachin-Jigar",
            albumName: "Saiyaara",
            duration: 272_000,
        });
        const unrelated = makeTrack({
            title: "Humsafar",
            author: "Kavita Seth",
            albumName: "Another Movie",
            duration: 240_000,
        });
        const s1 = scoreCandidate(saiyaara, intent, can).score;
        const s2 = scoreCandidate(unrelated, intent, can).score;
        assert.ok(s1 > s2, `Saiyaara score (${s1}) should beat unrelated (${s2})`);
    });
});

describe("scoreCandidate — humsafar original", () => {
    const intent = parseQueryIntent("humsafar original");
    const can = canonical({ title: "Humsafar original", artist: "Sachin-Jigar", durationMs: 271_000 });

    it("cover version is penalized when user wants original", () => {
        const cover = makeTrack({
            title: "Humsafar (Cover by XYZ)",
            author: "Cover Artist",
            duration: 265_000,
        });
        const { score, reasons } = scoreCandidate(cover, intent, can);
        assert.ok(reasons.some(r => r.includes("cover")), "Expected cover penalty");
        const original = makeTrack({
            title: "Humsafar",
            author: "Sachin-Jigar",
            duration: 271_500,
        });
        assert.ok(scoreCandidate(original, intent, can).score > score, "Original should score higher than cover");
    });
});

describe("scoreCandidate — humsafar live (user requested)", () => {
    const intent = parseQueryIntent("humsafar live");
    const can = canonical({ title: "Humsafar live", artist: "Sachin-Jigar" });

    it("live version is NOT penalized when user requested it", () => {
        const live = makeTrack({ title: "Humsafar (Live)", author: "Sachin-Jigar", duration: 280_000 });
        const { reasons } = scoreCandidate(live, intent, can);
        assert.ok(!reasons.some(r => r.includes("live version (not requested)")), "Live should not be penalized when requested");
    });
});

describe("scoreCandidate — shape of you", () => {
    const intent = parseQueryIntent("shape of you");
    const can = canonical({ title: "Shape of You", artist: "Ed Sheeran", durationMs: 234_000 });

    it("correct result scores above 65", () => {
        const track = makeTrack({
            title: "Shape of You (Official Music Video)",
            author: "Ed Sheeran",
            duration: 234_000,
            sourceName: "youtube",
        });
        const { score } = scoreCandidate(track, intent, can);
        assert.ok(score >= 60, `Score was ${score}, expected ≥60`);
    });
});

describe("scoreCandidate — believer imagine dragons", () => {
    const intent = parseQueryIntent("believer imagine dragons");
    const can = canonical({ title: "Believer Imagine Dragons", artist: "Imagine Dragons", durationMs: 204_000 });

    it("karaoke version is penalized when not requested", () => {
        const karaoke = makeTrack({
            title: "Believer - Karaoke Version",
            author: "Imagine Dragons",
            duration: 204_000,
        });
        const { reasons } = scoreCandidate(karaoke, intent, can);
        assert.ok(reasons.some(r => r.includes("karaoke")), "Expected karaoke penalty");
    });
});

describe("scoreCandidate — junk content", () => {
    const intent = parseQueryIntent("humsafar");
    const can = canonical({ title: "Humsafar", artist: "Sachin-Jigar", durationMs: 271_000 });

    it("trailer is penalized heavily", () => {
        const trailer = makeTrack({ title: "Humsafar - Trailer", author: "T-Series", duration: 120_000 });
        const { reasons } = scoreCandidate(trailer, intent, can);
        assert.ok(reasons.some(r => r.includes("trailer")), "Trailer should be penalized");
    });

    it("clip under 60 seconds is penalized", () => {
        const clip = makeTrack({ title: "Humsafar", author: "Sachin-Jigar", duration: 30_000 });
        const { reasons } = scoreCandidate(clip, intent, can);
        assert.ok(reasons.some(r => r.includes("under 60s")), "Short clip should be penalized");
    });
});

describe("scoreCandidate — incorrect SoundCloud rejection", () => {
    const intent = parseQueryIntent("humsafar");
    const can = canonical({ title: "Humsafar", artist: "Sachin-Jigar", album: "Saiyaara", durationMs: 271_000 });

    it("SoundCloud result with wrong artist scores lower than correct YouTube result", () => {
        const scWrong = makeTrack({
            title: "Humsafar",
            author: "Unknown SC User",        // wrong artist
            duration: 180_000,                // wrong duration
            sourceName: "soundcloud",
        });
        const ytCorrect = makeTrack({
            title: "Humsafar (Official Audio)",
            author: "Sachin-Jigar",
            duration: 272_000,
            albumName: "Saiyaara",
            sourceName: "youtubemusic",
        });
        const scScore = scoreCandidate(scWrong, intent, can).score;
        const ytScore = scoreCandidate(ytCorrect, intent, can).score;
        assert.ok(ytScore > scScore,
            `Correct YT (${ytScore}) should beat wrong SC (${scScore})`);
    });
});

console.log("All musicSearchService tests passed ✓");
