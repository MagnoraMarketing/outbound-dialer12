"use client";

import { Crown, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { MagnoraEmpire } from "@/components/game/magnora-empire";
import { WhoIsTheBest } from "@/components/game/who-is-the-best";

type GameKey = "empire" | "snake";
const STORAGE_KEY = "nordcall-selected-game";

// The games under "Spil": pick Magnora Empire or WhoIsTheBest.
export function GamesHub() {
  const [game, setGame] = useState<GameKey>("empire");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "empire" || saved === "snake") setGame(saved);
    } catch { /* storage unavailable */ }
  }, []);
  function choose(next: GameKey) {
    setGame(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  }
  return <div className="games-hub">
    <div className="games-switch" role="tablist" aria-label="Vælg spil">
      <button role="tab" aria-selected={game === "empire"} className={game === "empire" ? "games-active" : ""} onClick={() => choose("empire")}>
        <span className="games-icon games-icon-empire"><Crown size={18} /></span>
        <span><strong>Magnora Empire</strong><small>Byg din virksomhed med dine resultater</small></span>
      </button>
      <button role="tab" aria-selected={game === "snake"} className={game === "snake" ? "games-active" : ""} onClick={() => choose("snake")}>
        <span className="games-icon games-icon-snake"><Trophy size={18} /></span>
        <span><strong>WhoIsTheBest</strong><small>Snake med teamets rangliste</small></span>
      </button>
    </div>
    {game === "empire" ? <MagnoraEmpire /> : <div className="view wb-page">
      <div className="mg-title"><span className="mg-logo wb-logo"><Trophy size={22} /></span><div><h1>WHO IS THE BEST</h1><p>Én pause. Ét spil. Hvem tager førstepladsen?</p></div></div>
      <WhoIsTheBest />
    </div>}
  </div>;
}
