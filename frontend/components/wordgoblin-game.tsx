"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type GuessResult,
  type DayState,
  loadDayState,
  saveDayState,
  loadStats,
  recordWin,
  recordGiveUp,
  computeGameScore,
  type ScoreBreakdown,
} from "@/lib/game/daily";
import {
  type AttributeKind,
  type AttributeSuggestion,
  type DailyGame,
  type RevealedAnswer,
  type SearchSuggestion,
  getDailyGame,
  getClue,
  giveUp,
  searchCatalogCombined,
  submitAttribute,
  submitGuess,
} from "@/lib/game/client";
import { searchLocalCatalog, findLocalPoster } from "@/lib/game/local-search";
import { deriveCaseFile, describeYearWindow } from "@/lib/game/casefile";
import {
  shareCardImage,
  copyCardImageToClipboard,
  downloadCardImage,
  captureCardImage,
} from "@/lib/game/card-image";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCORE_SEGMENTS = 10;

type ComboOption =
  | { type: "movie"; movie: SearchSuggestion }
  | { type: "attribute"; attr: AttributeSuggestion };

function formatPuzzleDate(isoDate: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${isoDate}T00:00:00Z`));
  } catch {
    return isoDate;
  }
}

function yearBadge(relation: "same" | "earlier" | "later", year: number) {
  if (relation === "same") {
    return { symbol: "=", title: `Today's film was released in ${year}` };
  }
  if (relation === "later") {
    return { symbol: "▲", title: `Today's film was released after ${year}` };
  }
  return { symbol: "▼", title: `Today's film was released before ${year}` };
}

function attrBadgeCode(kind: AttributeKind): string {
  switch (kind) {
    case "director":
      return "D";
    case "actor":
      return "★";
    case "year":
      return "YR";
    case "genre":
      return "GN";
    case "language":
      return "LG";
  }
}

function AnswerCard({ answer }: { answer: RevealedAnswer }) {
  const [imgFailed, setImgFailed] = useState(false);
  const posterUrl = answer.poster_url || findLocalPoster(answer.title, answer.year);
  const facts = [
    answer.director ? { k: "Director", v: answer.director } : null,
    answer.cast?.length ? { k: "Starring", v: answer.cast.slice(0, 4).join(", ") } : null,
    answer.genres?.length ? { k: "Genre", v: answer.genres.join(" · ") } : null,
    answer.language || answer.runtime
      ? {
          k: "Details",
          v: [answer.language, answer.runtime ? `${answer.runtime} min` : ""].filter(Boolean).join(" · "),
        }
      : null,
  ].filter((f): f is { k: string; v: string } => f !== null);

  return (
    <div className="mg-answer">
      <div className="mg-answer-layout">
        {posterUrl && !imgFailed && (
          <div className="mg-answer-poster-frame">
            <img
              src={posterUrl}
              alt={answer.title}
              className="mg-answer-poster"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
            />
          </div>
        )}
        <div className="mg-answer-content">
          <p className="mg-answer-title">
            {answer.title} <span className="mg-answer-year">({answer.year})</span>
          </p>
          {facts.length > 0 && (
            <dl className="mg-answer-facts">
              {facts.map((f) => (
                <div key={f.k} className="mg-answer-fact">
                  <dt>{f.k}</dt>
                  <dd>{f.v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Two-Sided Flip Score Card ────────────────────────────────────────────────

type ScoreCardProps = {
  breakdown: ScoreBreakdown;
  answer?: RevealedAnswer;
  dateLabel: string;
  solved: boolean;
  copied: boolean;
  onShare: () => void;
  onReset: () => void;
};

function ScoreCard({ breakdown, answer, dateLabel, solved, copied, onShare, onReset }: ScoreCardProps) {
  const [flipped, setFlipped] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const frontCardRef = useRef<HTMLDivElement>(null);
  const backCardRef = useRef<HTMLDivElement>(null);

  const posterUrl = answer ? answer.poster_url || findLocalPoster(answer.title, answer.year) : undefined;
  const guessNo = String(breakdown.guessCount).padStart(2, "0");
  const toggle = () => setFlipped((f) => !f);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 4500);
  };

  const getActiveCardEl = () => (flipped ? backCardRef.current : frontCardRef.current);

  const handleShareCardImage = async () => {
    setIsGenerating(true);
    try {
      const cardEl = getActiveCardEl();
      const res = await shareCardImage(cardEl, {
        breakdown,
        answer,
        dateLabel,
        flipped,
        solved,
      });
      if (res === "copied") {
        showToast("✓ Card image copied to clipboard! Paste into Stories or chat.");
      } else if (res === "downloaded") {
        showToast("✓ Card image saved as PNG!");
      } else {
        showToast("✓ Card shared!");
      }
    } catch (e) {
      console.warn("Share image failed:", e);
      showToast("Could not open share drawer. Try 'Copy Image' instead.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCardImage = async () => {
    setIsGenerating(true);
    try {
      const cardEl = getActiveCardEl();
      const success = await copyCardImageToClipboard(cardEl, {
        breakdown,
        answer,
        dateLabel,
        flipped,
        solved,
      });
      if (success) {
        showToast("✓ Card image copied! Paste as sticker in Instagram Stories or chat.");
      } else {
        showToast("✓ Card image downloaded as PNG!");
      }
    } catch (e) {
      console.warn("Copy image failed:", e);
      showToast("Copy failed. Tap 'Save PNG' to download.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadCard = async () => {
    setIsGenerating(true);
    try {
      const cardEl = getActiveCardEl();
      const blob = await captureCardImage(cardEl, {
        breakdown,
        answer,
        dateLabel,
        flipped,
        solved,
      });
      downloadCardImage(blob, `MovieGoblin-${dateLabel}-${flipped ? "spec" : "badge"}.png`);
      showToast("✓ Card image saved as PNG!");
    } catch (e) {
      console.warn("Download card failed:", e);
      showToast("Could not download card.");
    } finally {
      setIsGenerating(false);
    }
  };

  const caseBonusText =
    breakdown.noCaseFileBonus > 0
      ? `+${breakdown.noCaseFileBonus} ★`
      : solved
        ? "+0 (Open)"
        : "+0";

  const tagline = solved
    ? `Solved in ${breakdown.guessCount} ${breakdown.guessCount === 1 ? "guess" : "guesses"} with sharp cinema instinct!`
    : "Signal lost today — come back tomorrow for a new film!";

  return (
    <div className={solved ? "mg-sc" : "mg-sc is-lost"}>
      <div className="mg-sc-scene">
        <div
          className={flipped ? "mg-sc-flipper is-flipped" : "mg-sc-flipper"}
          onClick={toggle}
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Score card back side. Click to flip to front side." : "Score card front side. Click to flip to back side."}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {/* ── SIDE A (FRONT): Bold Pixel Collector Wordmark (Zesty Saloon Top Card Style) ── */}
          <div ref={frontCardRef} className="mg-sc-face mg-sc-front" aria-hidden={flipped}>
            <div className="mg-sc-front-meta">
              <span>MOVIEGOBLIN · ID</span>
              <span>{dateLabel}</span>
            </div>

            <div className="mg-sc-hero-wordmark">
              <div className="mg-sc-hero-line1">
                <span>RANK {breakdown.rank}</span>
                <sup className="mg-sc-reg">®</sup>
              </div>
              <div className="mg-sc-hero-line2">
                {breakdown.total} PTS
              </div>
            </div>

            <div className="mg-sc-front-footer">
              <span className="mg-sc-front-role">{breakdown.rankTitle}</span>
              <span className="mg-sc-front-hint">SIDE A · TAP TO FLIP ↻</span>
            </div>
          </div>

          {/* ── SIDE B (BACK): Framed Art + Ruled Ledger + Circle Stamp + Tagline (Zesty Saloon Bottom Card Style) ── */}
          <div ref={backCardRef} className="mg-sc-face mg-sc-back" aria-hidden={!flipped}>
            <div className="mg-sc-back-frame">
              <div className="mg-sc-back-top">
                {/* Left Portrait / Pixel Mascot Well */}
                <div className="mg-sc-portrait">
                  {posterUrl && !imgFailed ? (
                    <img
                      src={posterUrl}
                      alt={answer?.title ?? "Movie poster"}
                      className="mg-sc-portrait-img"
                      crossOrigin="anonymous"
                      referrerPolicy="no-referrer"
                      onError={() => setImgFailed(true)}
                    />
                  ) : (
                    <div className="mg-sc-mascot" aria-hidden="true">
                      <svg viewBox="0 0 16 16" className="mg-sc-mascot-svg">
                        <path
                          fill="currentColor"
                          d="M4 1h8v2h2v3h1v4h-1v3h-2v2H4v-2H2v-3H1V6h1V3h2V1zm1 3v2H3v4h2v2h6v-2h2V6h-2V4H5zm1 2h2v2H6V6zm4 0h2v2h-2V6zm-3 4h4v1H7v-1z"
                        />
                      </svg>
                      <span>RANK {breakdown.rank}</span>
                    </div>
                  )}
                  <span className="mg-sc-portrait-tag">RANK {breakdown.rank}</span>
                </div>

                {/* Right Horizontal Ruled Specification Ledger */}
                <div className="mg-sc-ledger">
                  <div className="mg-sc-ledger-row is-brand">
                    <span>MOVIEGOBLIN</span>
                    <sup className="mg-sc-reg-sm">®</sup>
                  </div>
                  <div className="mg-sc-ledger-row is-subtitle">
                    <span>{breakdown.rankTitle}</span>
                  </div>
                  <div className="mg-sc-ledger-row is-stat">
                    <span>Base Solve</span>
                    <strong>+{breakdown.baseScore}</strong>
                  </div>
                  <div className="mg-sc-ledger-row is-stat">
                    <span>Efficiency ({breakdown.guessCount}g)</span>
                    <strong>+{breakdown.efficiencyBonus}</strong>
                  </div>
                  <div
                    className={
                      breakdown.noCaseFileBonus > 0
                        ? "mg-sc-ledger-row is-stat is-bonus"
                        : "mg-sc-ledger-row is-stat is-muted"
                    }
                  >
                    <span>🔒 Case File</span>
                    <strong>{caseBonusText}</strong>
                  </div>

                  {/* Bottom Split Ledger + Circular Number Badge */}
                  <div className="mg-sc-ledger-split">
                    <div className="mg-sc-ledger-split-rows">
                      <div className="mg-sc-ledger-row is-stat">
                        <span>No-Clue Bonus</span>
                        <strong>+{breakdown.noClueBonus}</strong>
                      </div>
                      <div className="mg-sc-ledger-row is-stat is-total">
                        <span>Total Score</span>
                        <strong>{breakdown.total} PTS</strong>
                      </div>
                    </div>
                    <div className="mg-sc-stamp-box" title={`${breakdown.guessCount} guesses`}>
                      <div className="mg-sc-stamp-circle">
                        <span>{guessNo}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Full-Width Italic Tagline Strip */}
              <div className="mg-sc-tagline-bar">
                <p>{tagline}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Bottom Flip Option */}
      <button
        type="button"
        className="mg-sc-flip-btn"
        onClick={toggle}
        aria-pressed={flipped}
      >
        <span className="mg-sc-flip-icon" aria-hidden="true">⇄</span>
        <span>{flipped ? "FLIP TO FRONT SIDE (RANK BADGE)" : "FLIP CARD TO SEE BACK SIDE (BREAKDOWN)"}</span>
      </button>

      {/* Feedback Toast Notification */}
      {toastMsg && (
        <div className="mg-sc-toast" role="status" aria-live="polite">
          <span className="mg-sc-toast-dot">●</span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Action Buttons: Image Share, Image Copy, Save PNG, Copy Text, Play New */}
      <div className="mg-sc-actions">
        {solved && (
          <>
            <button
              type="button"
              className="mg-sc-btn-share-img"
              disabled={isGenerating}
              onClick={() => void handleShareCardImage()}
            >
              <span className="mg-sc-action-icon">{isGenerating ? "⏳" : "📸"}</span>
              <span>{isGenerating ? "CAPTURING CARD..." : "SHARE CARD IMAGE"}</span>
            </button>

            <div className="mg-sc-actions-row">
              <button
                type="button"
                className="mg-sc-btn-sub"
                disabled={isGenerating}
                onClick={() => void handleCopyCardImage()}
                title="Copy card image to clipboard (paste as sticker in Instagram Stories or chat)"
              >
                <span>📋</span> COPY IMAGE
              </button>
              <button
                type="button"
                className="mg-sc-btn-sub"
                disabled={isGenerating}
                onClick={() => void handleDownloadCard()}
                title="Save high-res PNG image"
              >
                <span>💾</span> SAVE PNG
              </button>
              <button
                type="button"
                className="mg-sc-btn-sub"
                onClick={onShare}
                title="Copy plain text score report"
              >
                <span>{copied ? "✓" : "📄"}</span> {copied ? "COPIED" : "TEXT"}
              </button>
            </div>
          </>
        )}

        <button type="button" className="mg-sc-btn-reset" onClick={onReset}>
          🔄 PLAY NEW / RESET PUZZLE
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WordGoblinGame() {
  const [dailyGame, setDailyGame] = useState<DailyGame | null>(null);
  const [dayState, setDayState] = useState<DayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  // Case File visibility
  const [caseFileVisible, setCaseFileVisible] = useState(true);
  const [copiedShare, setCopiedShare] = useState(false);

  // Combobox state: supports all 6,154 catalog movies (from 1 character) + attributes (Director, Actor, Year, Genre, Language)
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [attrSuggestions, setAttrSuggestions] = useState<AttributeSuggestion[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [clueLoading, setClueLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isWarning, setIsWarning] = useState(false);
  const [pulse, setPulse] = useState(false);

  // Three-dot menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [showGiveUpConfirm, setShowGiveUpConfirm] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // ── Load Daily Puzzle ──────────────────────────────────────────────────────
  async function fetchDailyPuzzle() {
    setLoading(true);
    setServerError(null);
    setStatusMessage("");

    try {
      const daily = await getDailyGame();
      setDailyGame(daily);
      let state = loadDayState(daily.date);

      // Backfill any missing poster URLs from local catalog
      state = {
        ...state,
        guesses: state.guesses.map((g) => ({
          ...g,
          poster_url: g.poster_url || findLocalPoster(g.matchedTitle || g.guess),
        })),
        revealedAnswer: state.revealedAnswer
          ? {
              ...state.revealedAnswer,
              poster_url:
                state.revealedAnswer.poster_url ||
                findLocalPoster(state.revealedAnswer.title, state.revealedAnswer.year),
            }
          : undefined,
      };

      if (state.surrendered && !state.solved && !state.revealedAnswer) {
        try {
          const { revealedAnswer } = await giveUp();
          const enrichedAnswer = {
            ...revealedAnswer,
            poster_url:
              revealedAnswer.poster_url ||
              findLocalPoster(revealedAnswer.title, revealedAnswer.year),
          };
          state = { ...state, revealedAnswer: enrichedAnswer };
          saveDayState(state);
        } catch {
          // ignore
        }
      }
      setDayState(state);
      // Keep Case File hidden at start unless player previously opened it today
      setCaseFileVisible(Boolean(state.caseFileOpened));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to reach the game server.";
      setServerError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchDailyPuzzle();
  }, []);

  // Close menu / suggestion list on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (comboRef.current && !comboRef.current.contains(target)) setListOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Catalog search (starts from 1 character: A, R, B, Z, etc.) ────────────
  useEffect(() => {
    const q = query.trim();
    if (selected && selected.label === query) return;
    if (q.length < 1) {
      setSuggestions([]);
      setAttrSuggestions([]);
      setActiveIdx(-1);
      return;
    }

    // Immediate local catalog filtering across all 6,154 movies
    const immediate = searchLocalCatalog(q, 40, 6);
    setSuggestions(immediate.results);
    setAttrSuggestions(immediate.attributes);
    setActiveIdx(immediate.results.length + immediate.attributes.length > 0 ? 0 : -1);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const remote = await searchCatalogCombined(q, controller.signal);
        if (!controller.signal.aborted) {
          setSuggestions(remote.results);
          setAttrSuggestions(remote.attributes);
          setActiveIdx((prev) =>
            prev >= 0 && prev < remote.results.length + remote.attributes.length
              ? prev
              : remote.results.length + remote.attributes.length > 0
                ? 0
                : -1
          );
        }
      } catch {
        // Keep local results on network error
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  // ── Derived Data ───────────────────────────────────────────────────────────
  const guesses = dayState?.guesses ?? [];
  const clues = dayState?.clues ?? [];
  const attributeChecks = dayState?.attributeChecks ?? [];
  const isGameOver = (dayState?.solved || dayState?.surrendered) ?? false;
  const canGuess = !loading && !serverError && !isGameOver && !submitting && Boolean(dayState);
  const stats = loadStats();
  const caseFile = deriveCaseFile(guesses, attributeChecks);
  const yearWindow = describeYearWindow(caseFile);
  const guessedLabels = new Set(guesses.map((g) => g.matchedTitle ?? g.guess));
  const bestSimilarity = guesses.reduce((m, g) => (g.isCorrect ? m : Math.max(m, g.similarity)), -1);

  const isCaseFileHidden = !caseFileVisible;
  const scoreBreakdown = dayState
    ? computeGameScore(dayState, isCaseFileHidden)
    : {
        total: 1500,
        baseScore: 500,
        efficiencyBonus: 500,
        noCaseFileBonus: 300,
        noClueBonus: 200,
        rank: "S+" as const,
        rankTitle: "APEX ORACLE",
        usedCaseFile: false,
        cluesUsed: 0,
        guessCount: 0,
      };

  const combinedOptions: ComboOption[] = [
    ...suggestions.map((movie): ComboOption => ({ type: "movie", movie })),
    ...attrSuggestions.map((attr): ComboOption => ({ type: "attribute", attr })),
  ];

  function warn(message: string) {
    setStatusMessage(message);
    setIsWarning(true);
  }

  function triggerPulse() {
    setPulse(true);
    setTimeout(() => setPulse(false), 280);
  }

  // ── Toggle / Reveal / Hide Case File ───────────────────────────────────────
  function handleToggleCaseFile() {
    setMenuOpen(false);
    if (!caseFileVisible) {
      setCaseFileVisible(true);
      if (dayState && !isGameOver && !dayState.caseFileOpened) {
        const updated: DayState = { ...dayState, caseFileOpened: true };
        setDayState(updated);
        saveDayState(updated);
      }
    } else {
      setCaseFileVisible(false);
    }
  }

  function handleHideCaseFileOption() {
    setMenuOpen(false);
    setCaseFileVisible(false);
    if (dayState && !isGameOver) {
      const updated: DayState = { ...dayState, caseFileOpened: false };
      setDayState(updated);
      saveDayState(updated);
      setStatusMessage("🔒 Case File Hidden! +300 Point Bonus active for solving without clues.");
      setIsWarning(false);
    }
  }

  // ── Reset Puzzle (clear today's local progress) ────────────────────────────
  function handleResetPuzzle() {
    localStorage.removeItem("wg:day");
    window.location.reload();
  }

  // ── Share Score Report ─────────────────────────────────────────────────────
  async function handleShareScore() {
    if (!dayState) return;
    const dateLabel = dailyGame ? dailyGame.date : dayState.date;
    const pureTag = !scoreBreakdown.usedCaseFile ? "🔒 PURE MODE (No Case File!)" : "📁 Case File Used";
    const text = [
      `🎬 MOVIEGOBLIN // ${dateLabel}`,
      dayState.solved
        ? `🏆 SCORE: ${scoreBreakdown.total} PTS [RANK ${scoreBreakdown.rank} · ${scoreBreakdown.rankTitle}]`
        : `💀 SIGNAL LOST (0 PTS)`,
      `🎯 ${guesses.length} ${guesses.length === 1 ? "Guess" : "Guesses"} · ${pureTag} · ${clues.length} ${clues.length === 1 ? "Clue" : "Clues"}`,
      `https://movie-goblin.vercel.app`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2400);
    } catch {
      // ignore clipboard errors
    }
  }

  // ── Suggestion picking ─────────────────────────────────────────────────────
  function pickMovieSuggestion(s: SearchSuggestion): boolean {
    if (guessedLabels.has(s.label)) {
      warn("Already guessed. Pick a different movie.");
      return false;
    }
    setSelected(s);
    setQuery(s.label);
    setListOpen(false);
    setStatusMessage("");
    setIsWarning(false);
    return true;
  }

  async function pickAttributeSuggestion(attr: AttributeSuggestion) {
    if (!dayState || submitting || isGameOver) return;
    setListOpen(false);
    setSubmitting(true);
    setStatusMessage("");
    setIsWarning(false);

    try {
      const checkResult = await submitAttribute(attr.kind, attr.value);
      const updatedChecks = [...(dayState.attributeChecks ?? []), checkResult];
      const newState: DayState = {
        ...dayState,
        attributeChecks: updatedChecks,
        caseFileOpened: true,
      };
      setDayState(newState);
      saveDayState(newState);
      setCaseFileVisible(true);
      triggerPulse();
      setStatusMessage(checkResult.message);
      setIsWarning(!checkResult.matched && attr.kind !== "year");
      setQuery("");
      setSelected(null);
      setSuggestions([]);
      setAttrSuggestions([]);
      inputRef.current?.focus();
    } catch (err) {
      warn(err instanceof Error ? err.message : "Could not check attribute.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleInputChange(value: string) {
    setQuery(value);
    setSelected(null);
    setListOpen(true);
    setStatusMessage("");
    setIsWarning(false);
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const total = combinedOptions.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setListOpen(true);
      setActiveIdx((i) => (total ? (i + 1) % total : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (total ? (i - 1 + total) % total : -1));
    } else if (e.key === "Escape") {
      setListOpen(false);
    } else if (e.key === "Enter" && !selected && listOpen && activeIdx >= 0 && combinedOptions[activeIdx]) {
      e.preventDefault();
      const opt = combinedOptions[activeIdx];
      if (opt.type === "movie") {
        if (pickMovieSuggestion(opt.movie)) void submitSelection(opt.movie);
      } else {
        void pickAttributeSuggestion(opt.attr);
      }
    }
  }

  // ── Guess Submission ───────────────────────────────────────────────────────
  async function submitSelection(choice: SearchSuggestion) {
    if (!dailyGame || !dayState || submitting) return;
    if (dayState.solved || dayState.surrendered) return;

    setSubmitting(true);
    setStatusMessage("");
    setIsWarning(false);

    try {
      const response = await submitGuess(choice.label, true);

      if (!response.recognized) {
        warn(response.message);
        return;
      }

      const poster =
        response.poster_url ||
        choice.poster_url ||
        findLocalPoster(response.matchedTitle || choice.label, choice.year);

      const result: GuessResult = {
        guess: response.matchedTitle || choice.label,
        similarity: response.similarity,
        similarityLabel: response.similarityLabel,
        isCorrect: response.isCorrect,
        matchedTitle: response.matchedTitle,
        poster_url: poster,
        hints: response.hints,
      };

      const solved = response.isCorrect;
      const revealed = response.revealedAnswer
        ? {
            ...response.revealedAnswer,
            poster_url:
              response.revealedAnswer.poster_url ||
              findLocalPoster(response.revealedAnswer.title, response.revealedAnswer.year),
          }
        : dayState.revealedAnswer;

      const newState: DayState = {
        ...dayState,
        guesses: [...dayState.guesses, result],
        solved,
        revealedAnswer: revealed,
      };

      setDayState(newState);
      saveDayState(newState);
      triggerPulse();

      if (solved) {
        const finalScore = computeGameScore(newState);
        recordWin(dayState.date, finalScore.total, !finalScore.usedCaseFile);
        setStatusMessage(
          !finalScore.usedCaseFile
            ? `PURE DETECTIVE SOLVE! +${finalScore.total} PTS (Rank ${finalScore.rank})`
            : `Brilliant! You named the movie (+${finalScore.total} PTS).`
        );
      }

      setQuery("");
      setSelected(null);
      setSuggestions([]);
      setAttrSuggestions([]);
      setListOpen(false);
      inputRef.current?.focus();
    } catch (err) {
      warn(err instanceof Error ? err.message : "Failed to evaluate guess.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      if (combinedOptions.length > 0 && activeIdx >= 0 && combinedOptions[activeIdx]) {
        const opt = combinedOptions[activeIdx];
        if (opt.type === "movie") {
          if (pickMovieSuggestion(opt.movie)) await submitSelection(opt.movie);
          return;
        }
        await pickAttributeSuggestion(opt.attr);
        return;
      }
      warn(query.trim() ? "Pick a movie from the dropdown list to guess." : "Start typing a movie title.");
      setListOpen(true);
      return;
    }
    await submitSelection(selected);
  }

  // ── Give Up Flow (reveals the answer) ──────────────────────────────────────
  function handleGiveUpClick() {
    setMenuOpen(false);
    setShowGiveUpConfirm(true);
  }

  async function handleConfirmGiveUp() {
    if (!dayState) return;
    try {
      const { revealedAnswer } = await giveUp();
      const enrichedAnswer = {
        ...revealedAnswer,
        poster_url:
          revealedAnswer.poster_url ||
          findLocalPoster(revealedAnswer.title, revealedAnswer.year),
      };
      const newState: DayState = { ...dayState, surrendered: true, revealedAnswer: enrichedAnswer };
      setDayState(newState);
      saveDayState(newState);
      recordGiveUp();
      setStatusMessage("");
      setIsWarning(false);
      setQuery("");
      setSelected(null);
      setSuggestions([]);
      setAttrSuggestions([]);
    } catch (err) {
      warn(err instanceof Error ? err.message : "Could not reveal the answer. Try again.");
    } finally {
      setShowGiveUpConfirm(false);
    }
  }

  // ── Clue Ladder (next clue on request) ─────────────────────────────────────
  async function handleClue() {
    setMenuOpen(false);
    if (!dayState || clueLoading || isGameOver) return;

    setClueLoading(true);
    try {
      const next = await getClue(clues.length + 1);
      const newState: DayState = { ...dayState, clues: [...clues, next] };
      setDayState(newState);
      saveDayState(newState);
      setStatusMessage("");
      setIsWarning(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      warn(message === "No such clue." ? "No more clues. Time to make a guess!" : message || "Could not load a clue.");
    } finally {
      setClueLoading(false);
    }
  }

  const listboxId = "mg-suggestions";
  const unlockedCaseCount = [
    Boolean(caseFile.director),
    caseFile.cast.length > 0,
    Boolean(yearWindow),
    caseFile.genres.length > 0,
    Boolean(caseFile.language),
  ].filter(Boolean).length;

  const isPureModeActive = !scoreBreakdown.usedCaseFile;

  return (
    <div className="mg-container">
      <main className="mg-main">
        {/* Physical Curved Black Bezel Framing the CRT Display */}
        <div className="mg-console-frame">
          <div className={pulse ? "mg-screen mg-screen-pulse" : "mg-screen"}>
            <div className="mg-screen-inner">
              {/* ── Retro Top Status Bar (Signal + Mail + Brand | Streak | Date + Battery) ── */}
              <header className="mg-screen-topbar">
                  <div className="mg-status-left">
                    <svg
                      className="mg-pixel-svg"
                      width="30"
                      height="18"
                      viewBox="0 0 26 16"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M1 1h7v2H6v2H5v10H3V5H2V3H1V1zm7 10h3v4H8v-4zm5-3h3v7h-3V8zm5-3h3v10h-3V5zm5-4h3v14h-3V1z"
                      />
                    </svg>
                    <svg
                      className="mg-pixel-svg"
                      width="24"
                      height="16"
                      viewBox="0 0 20 14"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M0 0h20v14H0V0zm2 2v2h2v2h2v2h4v2h0V8h4V6h2V4h2V2H2zm0 4v6h16V6h-2v2h-2v2H6V8H4V6H2z"
                      />
                    </svg>
                    <span className="mg-logo-text">MovieGoblin</span>
                  </div>

                  <div className="mg-status-right">
                    <span className="mg-date-badge">
                      {dailyGame ? formatPuzzleDate(dailyGame.date) : "TODAY"}
                    </span>
                    <svg
                      className="mg-pixel-svg"
                      width="32"
                      height="16"
                      viewBox="0 0 28 14"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M0 1h25v3h3v6h-3v3H0V1zm2 2v8h21V3H2zm2 1.5h4v5H4v-5zm5 0h4v5H9v-5zm5 0h4v5h-4v-5zm5 0h3v5h-3v-5z"
                      />
                    </svg>
                  </div>
                </header>

                {/* ── Top Hero Zone: Quote on Top + Primary Search Command Bar ── */}
                <div className="mg-top-command">
                  <div className="mg-hero">
                    <h1 className="mg-heading">
                      You know the movie. You just don&apos;t know it yet.
                      <span className="mg-cursor" aria-hidden="true" />
                    </h1>
                  </div>

                  {/* Server Error */}
                  {serverError && (
                    <div className="mg-banner mg-banner-error" role="alert">
                      <p className="mg-banner-title">Signal lost</p>
                      <p className="mg-banner-desc">{serverError}</p>
                      <button className="mg-btn-retry" onClick={() => void fetchDailyPuzzle()} type="button">
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Solved — Two-sided flip score card */}
                  {!serverError && dayState?.solved && (
                    <div className="mg-banner mg-banner-win" role="status">
                      <div className="mg-banner-body">
                        <div className="mg-win-header">
                          <div className="mg-win-info">
                            <p className="mg-banner-title">
                              Solved in {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}!
                            </p>
                            {dayState.revealedAnswer && <AnswerCard answer={dayState.revealedAnswer} />}
                          </div>
                          <ScoreCard
                            breakdown={scoreBreakdown}
                            answer={dayState.revealedAnswer}
                            dateLabel={formatPuzzleDate(dailyGame ? dailyGame.date : dayState.date)}
                            solved
                            copied={copiedShare}
                            onShare={() => void handleShareScore()}
                            onReset={handleResetPuzzle}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Gave up: answer revealed */}
                  {!serverError && dayState?.surrendered && !dayState.solved && (
                    <div className="mg-banner mg-banner-neutral" role="status">
                      <div className="mg-banner-body">
                        <div className="mg-win-header">
                          <div className="mg-win-info">
                            <p className="mg-banner-title">The answer was</p>
                            {dayState.revealedAnswer ? (
                              <AnswerCard answer={dayState.revealedAnswer} />
                            ) : (
                              <p className="mg-banner-desc">You gave up today. Come back tomorrow for a new film.</p>
                            )}
                          </div>
                          <ScoreCard
                            breakdown={scoreBreakdown}
                            answer={dayState.revealedAnswer}
                            dateLabel={formatPuzzleDate(dailyGame ? dailyGame.date : dayState.date)}
                            solved={false}
                            copied={copiedShare}
                            onShare={() => void handleShareScore()}
                            onReset={handleResetPuzzle}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Search combobox: movies (from 1st letter) + Director / Actor / Year / Genre / Language */}
                  {!isGameOver && (
                    <form className="mg-search-form" onSubmit={(e) => void handleSubmit(e)} noValidate autoComplete="off">
                      <div className="mg-search-bar">
                        <div className="mg-combobox" ref={comboRef}>
                          <input
                            ref={inputRef}
                            id="movie_goblin_guess_input"
                            name="movie_goblin_guess_input"
                            className="mg-input"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            data-lpignore="true"
                            data-form-type="other"
                            disabled={!canGuess && !submitting}
                            onChange={(e) => handleInputChange(e.target.value)}
                            onFocus={() => setListOpen(true)}
                            onKeyDown={handleInputKeyDown}
                            placeholder={
                              loading ? "Tuning in..." : "Search movie, director, actor, year, genre, language..."
                            }
                            value={query}
                            aria-label="Movie guess"
                            role="combobox"
                            aria-expanded={listOpen && combinedOptions.length > 0}
                            aria-controls={listboxId}
                            aria-autocomplete="list"
                            aria-activedescendant={activeIdx >= 0 ? `${listboxId}-${activeIdx}` : undefined}
                          />
                          {query.length > 0 && (
                            <button
                              type="button"
                              className="mg-input-clear"
                              onClick={() => {
                                handleInputChange("");
                                inputRef.current?.focus();
                              }}
                              aria-label="Clear input"
                            >
                              ✕
                            </button>
                          )}
                          {listOpen && query.trim().length >= 1 && (
                            <ul className="mg-suggestions" id={listboxId} role="listbox">
                              {combinedOptions.length === 0 ? (
                                <li className="mg-suggestion-empty" role="presentation">
                                  {searching ? "Searching catalog..." : "No matching movie in catalog"}
                                </li>
                              ) : (
                                combinedOptions.map((opt, i) => {
                                  if (opt.type === "movie") {
                                    const s = opt.movie;
                                    const already = guessedLabels.has(s.label);
                                    const sub = [
                                      s.originalTitle && s.originalTitle !== s.title ? s.originalTitle : null,
                                      s.director ?? null,
                                      s.language ?? null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ");

                                    return (
                                      <li
                                        key={`movie-${s.label}`}
                                        id={`${listboxId}-${i}`}
                                        role="option"
                                        aria-selected={i === activeIdx}
                                        aria-disabled={already}
                                        className={[
                                          "mg-suggestion",
                                          i === activeIdx ? "is-active" : "",
                                          already ? "is-guessed" : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ")}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          if (pickMovieSuggestion(s)) {
                                            void submitSelection(s);
                                          }
                                        }}
                                        onMouseEnter={() => setActiveIdx(i)}
                                      >
                                        <div className="mg-suggestion-left-wrap">
                                          {(() => {
                                            const posterSrc = s.poster_url || findLocalPoster(s.label, s.year);
                                            if (!posterSrc) return null;
                                            return (
                                              <div className="mg-suggestion-thumb-wrap">
                                                <img
                                                  src={posterSrc}
                                                  alt=""
                                                  className="mg-suggestion-thumb"
                                                  loading="lazy"
                                                  referrerPolicy="no-referrer"
                                                  onError={(e) => {
                                                    const wrap = (e.currentTarget as HTMLElement).closest(".mg-suggestion-thumb-wrap") as HTMLElement | null;
                                                    if (wrap) wrap.style.display = "none";
                                                  }}
                                                />
                                              </div>
                                            );
                                          })()}
                                          <div className="mg-suggestion-main">
                                            <span className="mg-suggestion-title">{s.title}</span>
                                            {sub && <span className="mg-suggestion-sub">{sub}</span>}
                                          </div>
                                        </div>
                                        <span className="mg-suggestion-year">{already ? "guessed" : s.year}</span>
                                      </li>
                                    );
                                  }

                                  const a = opt.attr;
                                  return (
                                    <li
                                      key={`attr-${a.kind}-${a.value}`}
                                      id={`${listboxId}-${i}`}
                                      role="option"
                                      aria-selected={i === activeIdx}
                                      className={["mg-suggestion", "mg-suggestion-attr", i === activeIdx ? "is-active" : ""]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        void pickAttributeSuggestion(a);
                                      }}
                                      onMouseEnter={() => setActiveIdx(i)}
                                    >
                                      <div className="mg-suggestion-attr-left">
                                        <span className="mg-badge is-found">{attrBadgeCode(a.kind)}</span>
                                        <span className="mg-suggestion-title">{a.label}</span>
                                      </div>
                                      <span className="mg-suggestion-year">check</span>
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                          )}
                        </div>

                        <div className="mg-search-actions">
                          <button
                            className="mg-btn-guess"
                            disabled={!canGuess || (!selected && combinedOptions.length === 0)}
                            type="submit"
                          >
                            {submitting ? "..." : "Guess"}
                          </button>

                          {/* Three-dot options menu: Case File, Clue, and Give Up */}
                          <div className="mg-menu-anchor" ref={menuRef}>
                            <button
                              className="mg-btn-dots"
                              onClick={() => setMenuOpen((o) => !o)}
                              type="button"
                              aria-label="Options"
                              aria-expanded={menuOpen}
                              aria-haspopup="menu"
                            >
                              •••
                            </button>
                            {menuOpen && (
                              <div className="mg-dropdown-menu" role="menu">
                                <button
                                  className="mg-dropdown-item"
                                  onClick={caseFileVisible ? handleHideCaseFileOption : handleToggleCaseFile}
                                  type="button"
                                  role="menuitem"
                                >
                                  {caseFileVisible ? "🔒 Hide Case File (+300 PTS)" : "📂 Open Case File"}
                                </button>
                                <button
                                  className="mg-dropdown-item"
                                  onClick={() => void handleClue()}
                                  type="button"
                                  role="menuitem"
                                  disabled={clueLoading}
                                >
                                  Clue{clues.length > 0 ? ` (${clues.length} used)` : ""}
                                </button>
                                <button
                                  className="mg-dropdown-item mg-dropdown-danger"
                                  onClick={handleGiveUpClick}
                                  type="button"
                                  role="menuitem"
                                >
                                  Give Up
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {statusMessage && (
                        <p className={isWarning ? "mg-status-msg mg-status-warn" : "mg-status-msg"} aria-live="polite">
                          {statusMessage}
                        </p>
                      )}
                    </form>
                  )}
                </div>

                {/* ── Main Console Workspace (Case File Dossier Bar + Guess History Log) ── */}
                {!serverError && (
                  <div className="mg-workspace">
                    {/* Sleek, prominent Case File Bar */}
                    <section className="mg-casefile-section" aria-label="Detective Case File">
                      <button
                        type="button"
                        className={`mg-casefile-bar ${caseFileVisible ? "is-open" : "is-closed"}`}
                        onClick={caseFileVisible ? handleHideCaseFileOption : handleToggleCaseFile}
                        aria-expanded={caseFileVisible}
                      >
                        <div className="mg-casefile-bar-left">
                          <span className="mg-casefile-bar-icon" aria-hidden="true">
                            {caseFileVisible ? "📂" : "📁"}
                          </span>
                          <span className="mg-casefile-bar-title">CASE FILE</span>
                          <span className="mg-casefile-bar-badge">
                            {unlockedCaseCount}/5 UNCOVERED
                          </span>
                        </div>
                        <div className="mg-casefile-bar-right">
                          {!caseFileVisible ? (
                            <span className="mg-pure-bonus-tag">🔒 +300 PURE BONUS</span>
                          ) : (
                            <span className="mg-pure-bonus-tag is-revealed">CLUES REVEALED</span>
                          )}
                          <span className="mg-casefile-bar-action">
                            {caseFileVisible ? "HIDE ▲" : "VIEW CLUES ▼"}
                          </span>
                        </div>
                      </button>

                      {caseFileVisible && (
                        <div className="mg-casefile-drawer">
                          <div className="mg-casefile-grid">
                            <div className="mg-case-row">
                              <span className={caseFile.director ? "mg-badge mg-badge-d is-found" : "mg-badge mg-badge-d"}>
                                D
                              </span>
                              <span className="mg-case-label">Director</span>
                              <span className={caseFile.director ? "mg-case-val" : "mg-case-val is-unknown"}>
                                {caseFile.director ?? "???"}
                              </span>
                            </div>
                            <div className="mg-case-row">
                              <span className={caseFile.cast.length ? "mg-badge mg-badge-star is-found" : "mg-badge mg-badge-star"}>
                                ★
                              </span>
                              <span className="mg-case-label">Cast</span>
                              <span className={caseFile.cast.length ? "mg-case-val" : "mg-case-val is-unknown"}>
                                {caseFile.cast.length ? caseFile.cast.join(", ") : "???"}
                              </span>
                            </div>
                            <div className="mg-case-row">
                              <span className={yearWindow ? "mg-badge mg-badge-year is-found" : "mg-badge mg-badge-year"}>
                                YR
                              </span>
                              <span className="mg-case-label">Released</span>
                              <span className={yearWindow ? "mg-case-val" : "mg-case-val is-unknown"}>
                                {yearWindow ?? "???"}
                              </span>
                            </div>
                            <div className="mg-case-row">
                              <span className={caseFile.genres.length ? "mg-badge is-found" : "mg-badge"}>GN</span>
                              <span className="mg-case-label">Genre</span>
                              <span className={caseFile.genres.length ? "mg-case-val" : "mg-case-val is-unknown"}>
                                {caseFile.genres.length ? caseFile.genres.join(" · ") : "???"}
                              </span>
                            </div>
                            <div className="mg-case-row">
                              <span className={caseFile.language ? "mg-badge is-found" : "mg-badge"}>LG</span>
                              <span className="mg-case-label">Language</span>
                              <span className={caseFile.language ? "mg-case-val" : "mg-case-val is-unknown"}>
                                {caseFile.language ?? "???"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </section>

                    {/* Clues revealed so far */}
                    {clues.length > 0 && (
                      <ol className="mg-clue-list" aria-label="Clues">
                        {clues.map((c) => (
                          <li key={c.n} className="mg-clue-item">
                            <span className="mg-clue-badge">
                              Clue {c.n}/{c.total} · {c.label}
                            </span>
                            <p className="mg-clue-body">{c.text}</p>
                          </li>
                        ))}
                      </ol>
                    )}

                    {/* Guess History Log */}
                    <section className="mg-history-section" aria-label="Guess history">
                      <div className="mg-history-header">
                        <span>
                          {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}
                        </span>
                        <span>Match %</span>
                      </div>

                      {guesses.length > 0 ? (
                        <div className="mg-history-list">
                          {[...guesses].reverse().map((item, revIdx) => {
                            const originalIndex = guesses.length - revIdx;
                            const h = item.hints;
                            const filled = Math.round((item.similarity / 100) * SCORE_SEGMENTS);
                            const isBest = !item.isCorrect && item.similarity === bestSimilarity && bestSimilarity >= 0;
                            return (
                              <div
                                key={`guess-${originalIndex}-${item.guess}`}
                                className={`mg-guess-item ${item.isCorrect ? "mg-guess-item-correct" : ""}`}
                              >
                                <div className="mg-guess-main">
                                  <div className="mg-guess-left">
                                    <span className="mg-guess-index">{String(originalIndex).padStart(2, "0")}</span>
                                    {(() => {
                                      const guessPoster = item.poster_url || findLocalPoster(item.matchedTitle || item.guess);
                                      if (!guessPoster) return null;
                                      return (
                                        <div className="mg-guess-thumb-wrap">
                                          <img
                                            src={guessPoster}
                                            alt=""
                                            className="mg-guess-thumb"
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                              const wrap = (e.currentTarget as HTMLElement).closest(".mg-guess-thumb-wrap") as HTMLElement | null;
                                              if (wrap) wrap.style.display = "none";
                                            }}
                                          />
                                        </div>
                                      );
                                    })()}
                                    <span className="mg-guess-title" title={item.matchedTitle || item.guess}>
                                      {item.matchedTitle || item.guess}
                                    </span>
                                    {isBest && <span className="mg-best-tag">Best</span>}
                                    {/* Show attribute hint badges inline next to movie name to save vertical space */}
                                    {h && (caseFileVisible || isGameOver) && (
                                      <div className="mg-hints">
                                        {h.director && (
                                          <span className="mg-badge mg-badge-d is-found" title={`Same director: ${h.director}`}>
                                            D
                                          </span>
                                        )}
                                        {h.cast.length > 0 && (
                                          <span
                                            className="mg-badge mg-badge-star is-found"
                                            title={`Shared actors: ${h.cast.join(", ")}`}
                                          >
                                            ★{h.cast.length > 1 ? h.cast.length : ""}
                                          </span>
                                        )}
                                        {h.language && (
                                          <span className="mg-badge is-found" title={`Same language: ${h.language}`}>
                                            {h.language.slice(0, 3).toUpperCase()}
                                          </span>
                                        )}
                                        {(() => {
                                          const y = yearBadge(h.year.relation, h.year.value);
                                          return (
                                            <span
                                              className={
                                                h.year.relation === "same" || h.year.within5
                                                  ? "mg-badge mg-badge-year is-found"
                                                  : "mg-badge mg-badge-year"
                                              }
                                              title={y.title}
                                            >
                                              {y.symbol} {h.year.value}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  <div className="mg-guess-right">
                                    <div className="mg-proximity-bar" aria-hidden="true">
                                      {Array.from({ length: SCORE_SEGMENTS }, (_, i) => (
                                        <span
                                          key={i}
                                          className={i < filled ? "mg-proximity-seg is-filled" : "mg-proximity-seg"}
                                        />
                                      ))}
                                    </div>
                                    <span className="mg-guess-score">{item.similarity}%</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mg-empty-state">
                          <p className="mg-empty-headline">READY FOR YOUR FIRST GUESS</p>
                          <p className="mg-empty-sub">
                            Type any movie title above to uncover match similarity and clue hints!
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {/* ── Bottom Console Softkey Bar ── */}
                <footer className="mg-softkey-bar">
                  <button className="mg-softkey-btn" onClick={() => setShowHowToPlay(true)} type="button">
                    How to Play
                  </button>
                  <button
                    type="button"
                    className="mg-softkey-streak"
                    onClick={() => setShowStats(true)}
                    title="View Career Stats, High Score & Streak"
                  >
                    <span className="mg-streak-bars" aria-hidden="true">
                      <i className={stats.currentStreak >= 1 ? "is-lit" : ""} />
                      <i className={stats.currentStreak >= 3 ? "is-lit" : ""} />
                      <i className={stats.currentStreak >= 7 ? "is-lit" : ""} />
                    </span>
                    <span className="mg-softkey-streak-text">
                      🔥 STREAK: {stats.currentStreak}D · {stats.won} SOLVED
                    </span>
                  </button>
                  <button
                    className="mg-softkey-btn"
                    onClick={() => (!isGameOver ? void handleClue() : setShowStats(true))}
                    disabled={!isGameOver && clueLoading}
                    type="button"
                  >
                    {!isGameOver ? `Clue${clues.length ? ` (${clues.length})` : ""}` : "Stats"}
                  </button>
                </footer>
              </div>
            </div>
          </div>
        </main>

      {/* ── Comprehensive Operator Manual (How to Play Modal) ── */}
      {showHowToPlay && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="how-title">
          <div className="mg-modal-card mg-modal-howto">
            <button className="mg-modal-close" onClick={() => setShowHowToPlay(false)} type="button" aria-label="Close">
              ✕
            </button>
            <div className="mg-modal-kicker">MG-84 OPERATOR&apos;S MANUAL</div>
            <h2 id="how-title" className="mg-modal-heading">How to Play MovieGoblin</h2>

            <div className="mg-modal-content">
              <div className="mg-howto-steps">
                <div className="mg-howto-step">
                  <span className="mg-step-num">01</span>
                  <div>
                    <strong>Make a Guess &amp; Daily Movie Selection</strong>
                    <p>
                      Type any movie title (starting from 1 letter) to guess. MovieGoblin features a curated, unpredictable rotation of English &amp; World Cinema masterpieces alongside iconic Tollywood (Telugu) blockbusters &amp; classics. Our intelligent daily algorithm guarantees <strong>no movie or director ever repeats from today to tomorrow</strong>!
                    </p>
                  </div>
                </div>

                <div className="mg-howto-step mg-howto-step-highlight">
                  <span className="mg-step-num">★</span>
                  <div>
                    <strong>Option: Hide Case File for Extra Points (+300 PTS)</strong>
                    <p>
                      Want to make your deduction more challenging and score more points? Use the <strong>Hide Case File</strong> option!
                      If you deduce and solve today&apos;s film while keeping the Case File hidden (without viewing Director, Cast, Year, Genre, or Language clues), an extra <strong>+300 BONUS POINTS</strong> are added to your final score card!
                      Prefer clues? You can open the Case File anytime, or re-hide it to re-lock the +300 bonus.
                    </p>
                  </div>
                </div>

                <div className="mg-howto-step">
                  <span className="mg-step-num">02</span>
                  <div>
                    <strong>Match % Proximity &amp; Warmth</strong>
                    <p>
                      Every guess returns a calibrated <strong>0%–99% Match Score</strong> measuring semantic similarity across plot themes, genre, release era, director, cast, language, and franchise. Reach <strong>100%</strong> to win!
                    </p>
                  </div>
                </div>

                <div className="mg-howto-step">
                  <span className="mg-step-num">03</span>
                  <div>
                    <strong>Direct Attribute Verification</strong>
                    <p>
                      Want to test a hunch? Type any <strong>Director</strong>, <strong>Actor</strong>, <strong>Release Year</strong>, <strong>Genre</strong>, or <strong>Language</strong> into the search box and click <strong>check</strong> to immediately confirm if it belongs to today&apos;s film (this automatically opens your Case File).
                    </p>
                  </div>
                </div>

                <div className="mg-howto-step">
                  <span className="mg-step-num">04</span>
                  <div>
                    <strong>Progressive Clue Ladder</strong>
                    <p>
                      Need an extra nudge? Press <strong>Clue</strong> at the bottom-right to unlock up to 6 progressive hints: <em>Genre → Decade Era → Language/Runtime → Director Initials → Lead Actor&apos;s First Name → Masked Plot → Exact Release Year</em>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Point Scoring & Rank Breakdown */}
              <div className="mg-scoring-guide">
                <div className="mg-legend-title">Console Point Scoring (Up to 1,500 PTS)</div>
                <div className="mg-scoring-grid">
                  <div className="mg-scoring-item">
                    <span className="mg-scoring-pts">+500 PTS</span>
                    <span className="mg-scoring-desc"><strong>Base Solve</strong> — Awarded for naming today&apos;s movie</span>
                  </div>
                  <div className="mg-scoring-item">
                    <span className="mg-scoring-pts">+500 PTS</span>
                    <span className="mg-scoring-desc"><strong>Guess Efficiency</strong> — -45 pts per extra guess (min +100)</span>
                  </div>
                  <div className="mg-scoring-item is-highlight">
                    <span className="mg-scoring-pts">+300 PTS</span>
                    <span className="mg-scoring-desc"><strong>Case File Hidden Bonus</strong> — Solve with Case File hidden!</span>
                  </div>
                  <div className="mg-scoring-item">
                    <span className="mg-scoring-pts">+200 PTS</span>
                    <span className="mg-scoring-desc"><strong>No Clues Bonus</strong> — -50 pts per progressive Clue used</span>
                  </div>
                </div>
                <div className="mg-ranks-bar">
                  <span>RANKS:</span>
                  <strong>S+ (1350+)</strong>
                  <strong>S (1150+)</strong>
                  <strong>A (950+)</strong>
                  <strong>B (750+)</strong>
                  <strong>C (&lt;750)</strong>
                </div>
              </div>

              {/* Case File Badge Decoder */}
              <div className="mg-legend">
                <div className="mg-legend-title">Case File Badge Decoder</div>
                <div className="mg-legend-grid">
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-d is-found">D</span>
                    <span><strong>Director</strong> confirmed match</span>
                  </div>
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-star is-found">★2</span>
                    <span>Shared <strong>Actors</strong> in cast</span>
                  </div>
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-year is-found">▲ 1994</span>
                    <span>Released <strong>after</strong> 1994 (▼ before, = exact)</span>
                  </div>
                  <div className="mg-legend-row">
                    <span className="mg-badge is-found">GN / LG</span>
                    <span>Matching <strong>Genre</strong> or <strong>Language</strong></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Career Stats, Streak & High Score Modal ── */}
      {showStats && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stats-title">
          <div className="mg-modal-card">
            <button className="mg-modal-close" onClick={() => setShowStats(false)} type="button" aria-label="Close">
              ✕
            </button>
            <div className="mg-modal-kicker">OPERATOR RECORD</div>
            <h2 id="stats-title" className="mg-modal-heading">Streak &amp; Career Score</h2>

            <div className="mg-streak-hero">
              <div className="mg-streak-hero-left">
                <span className="mg-streak-hero-num">{stats.currentStreak}</span>
                <span className="mg-streak-hero-label">Day Active Streak</span>
              </div>
              <div className="mg-streak-meter" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <span
                    key={i}
                    className={i < Math.min(7, stats.currentStreak) ? "mg-streak-cell is-active" : "mg-streak-cell"}
                  />
                ))}
              </div>
            </div>

            <div className="mg-stats-row">
              <div className="mg-stat-box">
                <strong>{stats.played}</strong>
                <span>Played</span>
              </div>
              <div className="mg-stat-box">
                <strong>{stats.won}</strong>
                <span>Solved</span>
              </div>
              <div className="mg-stat-box">
                <strong>{stats.played ? Math.round((stats.won / stats.played) * 100) : 0}%</strong>
                <span>Win Rate</span>
              </div>
              <div className="mg-stat-box">
                <strong>{stats.maxStreak}</strong>
                <span>Best Streak</span>
              </div>
            </div>

            <div className="mg-stats-row mg-stats-row-secondary">
              <div className="mg-stat-box">
                <strong>{stats.bestScore ?? 0}</strong>
                <span>Best Score</span>
              </div>
              <div className="mg-stat-box">
                <strong>{stats.totalScore ?? 0}</strong>
                <span>Total Points</span>
              </div>
              <div className="mg-stat-box">
                <strong>{stats.pureWins ?? 0}</strong>
                <span>Pure Wins (No Case File)</span>
              </div>
              <div className="mg-stat-box">
                <strong>{dayState?.solved ? scoreBreakdown.rank : "—"}</strong>
                <span>Today&apos;s Rank</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Give Up Confirmation Modal ── */}
      {showGiveUpConfirm && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="giveup-title">
          <div className="mg-modal-card mg-modal-small">
            <h2 id="giveup-title" className="mg-modal-heading">Give up today?</h2>
            <p className="mg-modal-text">
              We&apos;ll reveal today&apos;s movie and end this puzzle with 0 points. It counts as played and resets your streak.
            </p>
            <div className="mg-modal-buttons">
              <button className="mg-btn-secondary" onClick={() => setShowGiveUpConfirm(false)} type="button">
                Keep Guessing
              </button>
              <button className="mg-btn-danger" onClick={() => void handleConfirmGiveUp()} type="button">
                Reveal Answer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
