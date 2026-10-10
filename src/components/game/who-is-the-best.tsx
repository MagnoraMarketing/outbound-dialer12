"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crown, Medal, Pause, Play, RotateCcw, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { rank: number; user_id: string; name: string; score: number; at: string; me: boolean; challenger: boolean };
type Board = {
  today: Entry[]; week: Entry[]; all: Entry[]; personal_best: number;
  challenger: { name: string; score: number };
  latest: { name: string; score: number; at: string; me: boolean }[];
};
type Point = { x: number; y: number };
type Status = "ready" | "running" | "paused" | "over";

const SIZE = 20;
const START_SPEED = 140;
const MIN_SPEED = 70;
const DIRECTIONS: Record<string, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const KEYS: Record<string, keyof typeof DIRECTIONS> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right",
};

function randomFood(snake: Point[]): Point {
  for (;;) {
    const food = { x: Math.floor(Math.random() * SIZE), y: Math.floor(Math.random() * SIZE) };
    if (!snake.some((part) => part.x === food.x && part.y === food.y)) return food;
  }
}

function themeColor(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// WhoIsTheBest: classic snake. Every finished game is shared on the team's
// leaderboard, so colleagues can chase each other's best score.
export function WhoIsTheBest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Point[]>([]);
  const directionRef = useRef<Point>(DIRECTIONS.right);
  const queuedRef = useRef<Point[]>([]);
  const foodRef = useRef<Point>({ x: 14, y: 10 });
  const startedRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pausedAtRef = useRef(0);
  const [status, setStatus] = useState<Status>("ready");
  const [score, setScore] = useState(0);
  const [board, setBoard] = useState<Board | null>(null);
  const [period, setPeriod] = useState<"today" | "week" | "all">("today");
  const [message, setMessage] = useState("");

  const loadBoard = useCallback(async () => {
    try {
      const response = await fetch("/api/games/snake");
      if (response.ok) setBoard(await response.json());
    } catch { /* the board is optional while playing */ }
  }, []);
  useEffect(() => { void loadBoard(); }, [loadBoard]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cell = canvas.width / SIZE;
    context.fillStyle = themeColor("--snake-board", "#101a33");
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = themeColor("--snake-grid", "#16223f");
    for (let x = 0; x < SIZE; x += 1) for (let y = 0; y < SIZE; y += 1) if ((x + y) % 2 === 0) context.fillRect(x * cell, y * cell, cell, cell);
    const food = foodRef.current;
    context.fillStyle = "#f5c451";
    context.beginPath();
    context.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * 0.36, 0, Math.PI * 2);
    context.fill();
    snakeRef.current.forEach((part, index) => {
      context.fillStyle = index === 0 ? "#8b98ee" : "#5b6fe0";
      const inset = index === 0 ? 1 : 2;
      context.beginPath();
      context.roundRect(part.x * cell + inset, part.y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.28);
      context.fill();
    });
  }, []);

  const reset = useCallback(() => {
    snakeRef.current = [{ x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }];
    directionRef.current = DIRECTIONS.right;
    queuedRef.current = [];
    foodRef.current = randomFood(snakeRef.current);
    setScore(0);
    draw();
  }, [draw]);
  useEffect(() => { reset(); }, [reset]);

  const finish = useCallback(async (finalScore: number) => {
    setStatus("over");
    const duration = Math.round(performance.now() - startedRef.current - pausedMsRef.current);
    if (finalScore <= 0) { setMessage("Prøv igen – den første bid er den sværeste."); return; }
    try {
      const response = await fetch("/api/games/snake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: finalScore, duration_ms: duration }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setMessage(body?.error ?? "Scoren kunne ikke deles."); return; }
      const champion = board?.challenger.score ?? 30;
      setMessage(finalScore > champion ? `Du slog ${board?.challenger.name ?? "Snake-mesteren"}! ${finalScore} point er delt med teamet.`
        : body?.personal_best ? `Ny personlig rekord: ${finalScore} point – delt med teamet.` : `${finalScore} point er delt med teamet.`);
      await loadBoard();
    } catch {
      setMessage("Scoren kunne ikke deles. Tjek forbindelsen.");
    }
  }, [board, loadBoard]);

  useEffect(() => {
    if (status !== "running") return;
    const speed = Math.max(MIN_SPEED, START_SPEED - score * 2);
    const timer = window.setInterval(() => {
      const next = queuedRef.current.shift();
      if (next) directionRef.current = next;
      const snake = snakeRef.current;
      const head = { x: snake[0].x + directionRef.current.x, y: snake[0].y + directionRef.current.y };
      const eats = head.x === foodRef.current.x && head.y === foodRef.current.y;
      const body = eats ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.y < 0 || head.x >= SIZE || head.y >= SIZE || body.some((part) => part.x === head.x && part.y === head.y)) {
        window.clearInterval(timer);
        void finish(snake.length - 3);
        return;
      }
      snakeRef.current = [head, ...body];
      if (eats) {
        foodRef.current = randomFood(snakeRef.current);
        setScore(snakeRef.current.length - 3);
      }
      draw();
    }, speed);
    return () => window.clearInterval(timer);
  }, [status, score, draw, finish]);

  const turn = useCallback((name: keyof typeof DIRECTIONS) => {
    const wanted = DIRECTIONS[name];
    const last = queuedRef.current[queuedRef.current.length - 1] ?? directionRef.current;
    if (wanted.x === -last.x && wanted.y === -last.y) return;
    if (wanted.x === last.x && wanted.y === last.y) return;
    if (queuedRef.current.length < 3) queuedRef.current.push(wanted);
  }, []);

  const start = useCallback(() => {
    reset();
    setMessage("");
    startedRef.current = performance.now();
    pausedMsRef.current = 0;
    setStatus("running");
  }, [reset]);

  const togglePause = useCallback(() => {
    setStatus((current) => {
      if (current === "running") { pausedAtRef.current = performance.now(); return "paused"; }
      if (current === "paused") { pausedMsRef.current += performance.now() - pausedAtRef.current; return "running"; }
      return current;
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = KEYS[event.key] ?? KEYS[event.key.toLowerCase()];
      if (key) {
        event.preventDefault();
        if (status === "ready" || status === "over") start();
        turn(key);
      } else if (event.key === " ") {
        event.preventDefault();
        if (status === "ready" || status === "over") start(); else togglePause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, start, turn, togglePause]);

  const touch = useRef<Point | null>(null);
  const entries = board?.[period] ?? [];
  const champion = board?.challenger;
  const beaten = champion ? (board?.personal_best ?? 0) > champion.score : false;

  return <section className="wb-view">
    <div className="wb-play">
      <div className="wb-scorebar">
        <span><small>Score</small><strong>{score}</strong></span>
        <span><small>Din rekord</small><strong>{Math.max(board?.personal_best ?? 0, status === "over" ? score : 0)}</strong></span>
        {champion && <span className={beaten ? "wb-beaten" : ""}><small>{beaten ? "Slået" : "Slå"} {champion.name}</small><strong>{champion.score}</strong></span>}
      </div>
      <div className="wb-board"
        onTouchStart={(event) => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
        onTouchEnd={(event) => {
          if (!touch.current) return;
          const dx = event.changedTouches[0].clientX - touch.current.x;
          const dy = event.changedTouches[0].clientY - touch.current.y;
          touch.current = null;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
        }}>
        <canvas ref={canvasRef} width={400} height={400} aria-label="Snake-spillepladen" />
        {status !== "running" && <div className="wb-overlay">
          {status === "over" && <strong className="wb-final">{score} point</strong>}
          {status === "paused" && <strong className="wb-final">Pause</strong>}
          {message && <p>{message}</p>}
          {status === "ready" && <p>Spis de gyldne mønter, og undgå væggen og din egen hale. Hver score deles med teamet.</p>}
          <button className="button button-primary" onClick={status === "paused" ? togglePause : start}>
            {status === "paused" ? <><Play size={15} /> Fortsæt</> : status === "over" ? <><RotateCcw size={15} /> Spil igen</> : <><Play size={15} /> Start spil</>}
          </button>
          <small>Piletaster eller WASD · mellemrum = pause · swipe på mobil</small>
        </div>}
      </div>
      <div className="wb-pad" aria-label="Styring">
        <button aria-label="Op" onClick={() => turn("up")}><ArrowUp size={18} /></button>
        <div>
          <button aria-label="Venstre" onClick={() => turn("left")}><ArrowLeft size={18} /></button>
          <button aria-label={status === "running" ? "Pause" : "Start"} onClick={() => (status === "running" || status === "paused" ? togglePause() : start())}>
            {status === "running" ? <Pause size={16} /> : <Play size={16} />}</button>
          <button aria-label="Højre" onClick={() => turn("right")}><ArrowRight size={18} /></button>
        </div>
        <button aria-label="Ned" onClick={() => turn("down")}><ArrowDown size={18} /></button>
      </div>
    </div>

    <aside className="wb-side">
      <div className="panel wb-leaderboard">
        <div className="wb-lb-head"><span className="panel-eyebrow">TEAMETS RANGLISTE</span><Trophy size={16} /></div>
        <div className="mg-chips">{([["today", "I dag"], ["week", "7 dage"], ["all", "Altid"]] as const).map(([key, label]) =>
          <button key={key} className={period === key ? "mg-chip-active" : ""} onClick={() => setPeriod(key)}>{label}</button>)}</div>
        {board ? <ol>{entries.map((entry) => <li key={entry.user_id} className={`${entry.me ? "wb-me" : ""} ${entry.challenger ? "wb-challenger" : ""}`}>
          <span className="wb-rank">{entry.rank <= 3 ? <Medal size={15} className={`wb-medal-${entry.rank}`} /> : entry.rank}</span>
          <span className="wb-name">{entry.challenger && <Crown size={13} />} {entry.name}{entry.me ? " (dig)" : ""}{entry.challenger && <small>Udfordreren</small>}</span>
          <strong>{entry.score}</strong>
        </li>)}</ol> : <p className="mg-fineprint">Henter ranglisten …</p>}
        {board && entries.length <= 1 && <p className="mg-fineprint">Ingen kolleger på listen endnu. Sæt den første score!</p>}
      </div>
      {!!board?.latest.length && <div className="panel wb-latest">
        <span className="panel-eyebrow">SENESTE SPIL</span>
        <ul>{board.latest.map((game, index) => <li key={`${game.at}-${index}`}><span>{game.me ? "Dig" : game.name}</span><strong>{game.score}</strong>
          <small>{new Date(game.at).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</small></li>)}</ul>
      </div>}
    </aside>
  </section>;
}
