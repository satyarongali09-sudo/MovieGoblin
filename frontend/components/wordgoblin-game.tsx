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
import { searchLocalCatalog } from "@/lib/game/local-search";
import { deriveCaseFile, describeYearWindow } from "@/lib/game/casefile";

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
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WordGoblinGame() {
  const [dailyGame, setDailyGame] = useState<DailyGame | null>(null);
  const [dayState, setDayState] = useState<DayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

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

      if (state.surrendered && !state.solved && !state.revealedAnswer) {
        try {
          const { revealedAnswer } = await giveUp();
          state = { ...state, revealedAnswer };
          saveDayState(state);
        } catch {
          // ignore
        }
      }
      setDayState(state);
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
      };
      setDayState(newState);
      saveDayState(newState);
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

      const result: GuessResult = {
        guess: response.matchedTitle || choice.label,
        similarity: response.similarity,
        similarityLabel: response.similarityLabel,
        isCorrect: response.isCorrect,
        matchedTitle: response.matchedTitle,
        hints: response.hints,
      };

      const solved = response.isCorrect;
      const newState: DayState = {
        ...dayState,
        guesses: [...dayState.guesses, result],
        solved,
        revealedAnswer: response.revealedAnswer || dayState.revealedAnswer,
      };

      setDayState(newState);
      saveDayState(newState);
      triggerPulse();

      if (solved) {
        recordWin(dayState.date);
        setStatusMessage("Brilliant! You named the movie.");
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
      const newState: DayState = { ...dayState, surrendered: true, revealedAnswer };
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

  return (
    <div className="mg-container">
      <main className="mg-main">
        {/* Authentic Barrel-Curved Orange Console Screen Set Into Pure Pitch Black */}
        <div className="mg-console-frame">
          <div className={pulse ? "mg-screen mg-screen-pulse" : "mg-screen"}>
            {/* ── Nokia / Retro Console Top Status Bar (Signal + Mail + Brand | Streak | Date + Battery) ── */}
            <header className="mg-screen-topbar">
              <div className="mg-status-left">
                <svg
                  className="mg-pixel-svg"
                  width="26"
                  height="16"
                  viewBox="0 0 26 16"
                  aria-hidden="true"
                >
                  {/* Antenna + 4 ascending signal bars */}
                  <path
                    fill="currentColor"
                    d="M1 1h7v2H6v2H5v10H3V5H2V3H1V1zm7 10h3v4H8v-4zm5-3h3v7h-3V8zm5-3h3v10h-3V5zm5-4h3v14h-3V1z"
                  />
                </svg>
                <svg
                  className="mg-pixel-svg"
                  width="20"
                  height="14"
                  viewBox="0 0 20 14"
                  aria-hidden="true"
                >
                  {/* Pixel envelope / dossier icon */}
                  <path
                    fill="currentColor"
                    d="M0 0h20v14H0V0zm2 2v2h2v2h2v2h4v2h0V8h4V6h2V4h2V2H2zm0 4v6h16V6h-2v2h-2v2H6V8H4V6H2z"
                  />
                </svg>
                <span className="mg-logo-text">MovieGoblin</span>
              </div>

              {/* Creative Interactive Streak Pill Button in Top Console Bar */}
              <button
                type="button"
                className="mg-streak-pill"
                onClick={() => setShowStats(true)}
                title="View Career Stats & Streak"
              >
                <span className="mg-streak-bars" aria-hidden="true">
                  <i className={stats.currentStreak >= 1 ? "is-lit" : ""} />
                  <i className={stats.currentStreak >= 3 ? "is-lit" : ""} />
                  <i className={stats.currentStreak >= 7 ? "is-lit" : ""} />
                </span>
                <span className="mg-streak-text">
                  STREAK: {stats.currentStreak}D · {stats.won} WON
                </span>
              </button>

              <div className="mg-status-right">
                <span className="mg-date-badge">
                  {dailyGame ? formatPuzzleDate(dailyGame.date) : "TODAY"}
                </span>
                <svg
                  className="mg-pixel-svg"
                  width="28"
                  height="14"
                  viewBox="0 0 28 14"
                  aria-hidden="true"
                >
                  {/* 4-bar pixel battery icon matching reference image */}
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

              {/* Solved */}
              {!serverError && dayState?.solved && (
                <div className="mg-banner mg-banner-win" role="status">
                  <div className="mg-banner-body">
                    <p className="mg-banner-title">
                      Solved in {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}
                    </p>
                    {dayState.revealedAnswer && <AnswerCard answer={dayState.revealedAnswer} />}
                  </div>
                </div>
              )}

              {/* Gave up: answer revealed */}
              {!serverError && dayState?.surrendered && !dayState.solved && (
                <div className="mg-banner mg-banner-neutral" role="status">
                  <div className="mg-banner-body">
                    <p className="mg-banner-title">The answer was</p>
                    {dayState.revealedAnswer ? (
                      <AnswerCard answer={dayState.revealedAnswer} />
                    ) : (
                      <p className="mg-banner-desc">You gave up today. Come back tomorrow for a new film.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Search combobox: movies (from 1st letter) + Director / Actor / Year / Genre / Language */}
              {!isGameOver && (
                <form className="mg-search-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
                  <div className="mg-search-bar">
                    <div className="mg-combobox" ref={comboRef}>
                      <input
                        ref={inputRef}
                        className="mg-input"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
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
                                    <div className="mg-suggestion-main">
                                      <span className="mg-suggestion-title">{s.title}</span>
                                      {sub && <span className="mg-suggestion-sub">{sub}</span>}
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

                    <button
                      className="mg-btn-guess"
                      disabled={!canGuess || (!selected && combinedOptions.length === 0)}
                      type="submit"
                    >
                      {submitting ? "..." : "Guess"}
                    </button>

                    {/* Three-dot options menu: Clue and Give Up */}
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

                  {statusMessage && (
                    <p className={isWarning ? "mg-status-msg mg-status-warn" : "mg-status-msg"} aria-live="polite">
                      {statusMessage}
                    </p>
                  )}
                </form>
              )}
            </div>

            {/* ── Main 2-Column Console Workspace (Zero Wasted Space, No Endless Page Scroll) ── */}
            {!serverError && (
              <div className="mg-workspace-grid">
                {/* LEFT COLUMN: Case File Dossier + Progressive Clues */}
                <div className="mg-col-dossier">
                  <section className="mg-casefile" aria-label="Case file">
                    <div className="mg-panel-head">
                      <h2 className="mg-casefile-title">Case file</h2>
                      <span className="mg-panel-counter">{unlockedCaseCount}/5 UNLOCKED</span>
                    </div>
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
                      <span className="mg-case-label">Actors</span>
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
                </div>

                {/* RIGHT COLUMN: Guess History Log (Numbers Only + Attribute Badges) */}
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
                                <span className="mg-guess-title" title={item.matchedTitle || item.guess}>
                                  {item.matchedTitle || item.guess}
                                </span>
                                {isBest && <span className="mg-best-tag">Best</span>}
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
                            {h && (
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
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mg-empty-state">
                      <p className="mg-empty-headline">One mystery. Unlimited guesses.</p>
                      <p className="mg-empty-sub">
                        Guess any movie title for a 0–99% match score, or test a Director (D), Actor (★), Year (YR), Genre (GN), or Language (LG) directly.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ── Bottom Console Softkey Bar (Directly Inspired by Reference Image: Menu | Brand/Streak | Back) ── */}
            <footer className="mg-softkey-bar">
              <button className="mg-softkey-btn" onClick={() => setShowHowToPlay(true)} type="button">
                How to Play
              </button>
              <button className="mg-softkey-center" onClick={() => setShowStats(true)} type="button">
                {stats.currentStreak}D Streak · {stats.won} Solved
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
      </main>

      {/* ── Improved How to Play Instruction Panel ── */}
      {showHowToPlay && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="how-title">
          <div className="mg-modal-card mg-modal-howto">
            <button className="mg-modal-close" onClick={() => setShowHowToPlay(false)} type="button" aria-label="Close">
              ✕
            </button>
            <h2 id="how-title" className="mg-modal-heading">How to Play MovieGoblin</h2>

            <div className="mg-modal-content">
              <div className="mg-howto-steps">
                <div className="mg-howto-step">
                  <span className="mg-step-num">01</span>
                  <div>
                    <strong>Search Movies or Clues</strong>
                    <p>Type any movie title (from 1 letter) or test a Director, Actor, Release Year, Genre, or Language from the dropdown.</p>
                  </div>
                </div>
                <div className="mg-howto-step">
                  <span className="mg-step-num">02</span>
                  <div>
                    <strong>Read the Match % (0–99%)</strong>
                    <p>Every movie guess is scored across 8 dimensions: plot themes, keywords, genre, era, director, cast, language, and franchise. 100% wins!</p>
                  </div>
                </div>
                <div className="mg-howto-step">
                  <span className="mg-step-num">03</span>
                  <div>
                    <strong>Unlock the Case File</strong>
                    <p>Shared credits automatically lock into your Case File on the left. Need help? Use <strong>Clue</strong> or <strong>•••</strong> at any time.</p>
                  </div>
                </div>
              </div>

              <div className="mg-legend">
                <div className="mg-legend-title">Case File Badge Decoder</div>
                <div className="mg-legend-grid">
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-d is-found">D</span>
                    <span><strong>Director</strong> confirmed</span>
                  </div>
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-star is-found">★</span>
                    <span>Shared <strong>Actor</strong> in cast</span>
                  </div>
                  <div className="mg-legend-row">
                    <span className="mg-badge mg-badge-year is-found">▲ 1994</span>
                    <span>Released <strong>after</strong> (▼ before, = exact)</span>
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

      {/* ── Creative Streak & Career Stats Modal ── */}
      {showStats && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stats-title">
          <div className="mg-modal-card">
            <button className="mg-modal-close" onClick={() => setShowStats(false)} type="button" aria-label="Close">
              ✕
            </button>
            <h2 id="stats-title" className="mg-modal-heading">Streak &amp; Career Stats</h2>

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
          </div>
        </div>
      )}

      {/* ── Give Up Confirmation Modal ── */}
      {showGiveUpConfirm && (
        <div className="mg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="giveup-title">
          <div className="mg-modal-card mg-modal-small">
            <h2 id="giveup-title" className="mg-modal-heading">Give up today?</h2>
            <p className="mg-modal-text">
              We&apos;ll reveal today&apos;s movie and end this puzzle. It counts as played and resets your streak.
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
