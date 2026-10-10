"use client";

import {
  Award, Building2, Check, LockOpen, Coins, Crown, Gem, History, Lock, Pencil, Search, ShoppingBag, Sparkles, Store, Target, Trophy, TrendingUp, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IsoCity } from "@/components/game/iso-city";
import { MarketView } from "@/components/game/market-view";
import { categoryLabels, dkk, vkr, type Achievement, type GameAsset, type GameLevel, type GameState } from "@/components/game/game-types";

type Tab = "empire" | "shop" | "missions" | "market" | "history";



async function gameApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

export function MagnoraEmpire() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("empire");
  const [confirmAsset, setConfirmAsset] = useState<GameAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<GameLevel | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [marketView, setMarketView] = useState<"listings" | "mine">("listings");

  const load = useCallback(async () => {
    try {
      const next = await gameApi<GameState>("/api/game");
      setState((previous) => {
        if (previous && next.profile.level > previous.profile.level) {
          setLevelUp(next.levels.find((level) => level.level === next.profile.level) ?? null);
        }
        return next;
      });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Spillet kunne ikke indlæses.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function buy(asset: GameAsset) {
    setBusy(true);
    try {
      const before = new Set(state?.inventory.map((item) => item.id));
      await gameApi("/api/game/buy", { method: "POST", body: JSON.stringify({ asset_key: asset.key, request_id: crypto.randomUUID() }) });
      const next = await gameApi<GameState>("/api/game");
      const added = next.inventory.find((item) => !before.has(item.id));
      if (state && next.profile.level > state.profile.level) setLevelUp(next.levels.find((level) => level.level === next.profile.level) ?? null);
      setState(next);
      setHighlightId(added?.id ?? null);
      setNotice(`${asset.name} er købt og placeret i din virksomhed.`);
      setConfirmAsset(null);
      setTab("empire");
    } catch (buyError) {
      setError(buyError instanceof Error ? buyError.message : "Købet kunne ikke gennemføres.");
      setConfirmAsset(null);
    } finally {
      setBusy(false);
    }
  }

  async function unlockMarket() {
    setBusy(true);
    setError("");
    try {
      await gameApi("/api/game/market/unlock", { method: "POST" });
      await load();
      setNotice("Magnora Market er låst op! Start din første butik ved at sætte et aktiv til salg.");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Markedet kunne ikke låses op.");
    } finally {
      setBusy(false);
    }
  }

  function openMarket(view: "listings" | "mine") {
    setMarketView(view);
    setTab("market");
  }

  async function saveProfile(changes: { company_name?: string; public_profile?: boolean }) {
    try {
      await gameApi("/api/game/profile", { method: "PATCH", body: JSON.stringify(changes) });
      await load();
      setEditingName(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Profilen kunne ikke gemmes.");
    }
  }

  const assetByKey = useMemo(() => new Map((state?.assets ?? []).map((asset) => [asset.key, asset])), [state?.assets]);

  if (!state) {
    return <div className="view mg-view">
      <GameHeader />
      <div className="panel mg-loading">{error ? <><strong>Spillet kunne ikke åbnes</strong><p>{error}</p><button className="button button-primary" onClick={() => void load()}>Prøv igen</button></>
        : <><span className="loading-orbit" /><p>Bygger dit imperium …</p></>}</div>
    </div>;
  }

  const { profile, market } = state;
  const level = state.levels.find((item) => item.level === profile.level) ?? state.levels[0];
  const nextLevel = state.levels.find((item) => item.level === profile.level + 1);
  const ownsOffice = state.inventory.some((item) => item.asset_key === "office_starter");
  const office = assetByKey.get("office_starter");
  const levelProgress = nextLevel
    ? Math.min(100, Math.round(((profile.company_value - (level?.min_company_value ?? 0)) / Math.max(1, nextLevel.min_company_value - (level?.min_company_value ?? 0))) * 100))
    : 100;
  const cityItems = state.inventory.map((item) => ({ id: item.id, asset_key: item.asset_key, art: assetByKey.get(item.asset_key)?.art ?? "box", name: assetByKey.get(item.asset_key)?.name ?? item.asset_key }));

  return <div className="view mg-view">
    <GameHeader />
    {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role="status"><span>{error || notice}</span>
      <button aria-label="Luk besked" onClick={() => { setError(""); setNotice(""); }}><X size={16} /></button></div>}

    <section className="mg-hero">
      <div className="mg-company">
        <span className="mg-level-badge"><Crown size={15} /> Level {profile.level} · {level?.title}</span>
        {editingName ? <form className="mg-name-form" onSubmit={(event) => {
          event.preventDefault();
          void saveProfile({ company_name: String(new FormData(event.currentTarget).get("company_name") ?? "") });
        }}>
          <input name="company_name" defaultValue={profile.company_name} minLength={2} maxLength={60} required autoFocus aria-label="Virksomhedens navn" />
          <button className="icon-button" aria-label="Gem navn"><Check size={16} /></button>
          <button type="button" className="icon-button" aria-label="Annuller" onClick={() => setEditingName(false)}><X size={16} /></button>
        </form> : <h2>{profile.company_name} <button className="icon-button mg-edit" aria-label="Omdøb virksomheden" onClick={() => setEditingName(true)}><Pencil size={14} /></button></h2>}
        <div className="mg-xp"><span>{nextLevel ? `Mod level ${nextLevel.level} · ${nextLevel.title}` : "Højeste level nået"}</span>
          <div className="mg-bar"><i style={{ width: `${levelProgress}%` }} /></div>
          <small>{nextLevel ? `Virksomhedsværdi ${vkr(profile.company_value)} / ${vkr(nextLevel.min_company_value)}${nextLevel.required_asset && !ownsOffice ? " · kræver første kontor" : ""}` : `${profile.xp.toLocaleString("da-DK")} XP`}</small>
        </div>
      </div>
      <div className="mg-stats">
        <Stat icon={Coins} label="Disponibel saldo" value={vkr(profile.balance)} tone="gold" />
        <Stat icon={Gem} label="Samlet virtuel formue" value={vkr(profile.net_worth)} tone="violet" />
        <Stat icon={Building2} label="Virksomhedens værdi" value={vkr(profile.company_value)} tone="blue" />
        <Stat icon={Sparkles} label="XP" value={profile.xp.toLocaleString("da-DK")} tone="teal" />
      </div>
    </section>

    <section className={`mg-unlock ${market.unlocked ? "mg-unlock-open" : market.ready ? "mg-unlock-ready" : ""}`}>
      <div className="mg-unlock-icon">{market.unlocked ? <Store size={22} /> : market.ready ? <LockOpen size={22} /> : <Lock size={22} />}</div>
      <div className="mg-unlock-body">
        <span className="eyebrow">{market.unlocked ? "MAGNORA MARKET ER ÅBEN" : market.ready ? "DU KAN LÅSE MAGNORA MARKET OP" : "UNLOCK MAGNORA MARKET"}</span>
        <strong>{dkk(profile.verified_earnings_dkk)} / {dkk(market.threshold_dkk)}</strong>
        <div className="mg-bar mg-bar-gold"><i style={{ width: `${market.percent}%` }} /></div>
        <small>{market.unlocked
          ? `Låst op ${new Date(market.unlocked_at ?? "").toLocaleDateString("da-DK")}. Adgangen er permanent.`
          : market.ready ? `Du har rundet ${dkk(market.threshold_dkk)} i godkendt salgsindtjening. Lås markedet op, og start din første butik.`
          : `${dkk(market.remaining_dkk)} tilbage · ${market.percent.toLocaleString("da-DK")} % gennemført. Tæller kun godkendt salgsindtjening – ikke virtuelle kroner.`}</small>
      </div>
      {market.unlocked
        ? <div className="mg-unlock-actions">
          {!state.inventory.some((item) => item.listed) && <button className="button mg-button-gold" onClick={() => openMarket("mine")}><Store size={15} /> Start din første butik</button>}
          <button className="button button-secondary" onClick={() => openMarket("listings")}>Gå til markedet</button>
        </div>
        : market.ready
          ? <button className="button mg-button-gold" disabled={busy} onClick={() => void unlockMarket()}><LockOpen size={15} /> {busy ? "Låser op …" : "Lås Magnora Market op"}</button>
          : <button className="button mg-button-gold" onClick={() => openMarket("listings")}>Se markedet</button>}
    </section>

    <nav className="mg-tabs" role="tablist" aria-label="Spillets sektioner">
      {([["empire", "Mit imperium", Building2], ["shop", "Butik", ShoppingBag], ["missions", "Missioner", Trophy], ["market", "Magnora Market", Store], ["history", "Historik", History]] as const).map(([key, label, Icon]) =>
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "mg-tab-active" : ""} onClick={() => setTab(key)}>
          <Icon size={15} /> {label}{key === "market" && !market.unlocked && <Lock size={12} />}
        </button>)}
    </nav>

    {tab === "empire" && <section className="mg-empire">
      <div className="mg-city-panel">
        <IsoCity items={cityItems} highlightId={highlightId} nextPlotLabel={ownsOffice ? null : "Første kontor"} />
      </div>
      <aside className="mg-side">
        {!ownsOffice && office && <div className="panel mg-goal">
          <span className="panel-eyebrow">DIT FØRSTE MÅL</span>
          <h3>Køb dit første kontor</h3>
          <p>Tjen {vkr(office.price)} gennem godkendte møder og salg, og byg dit første kontor på grunden.</p>
          <div className="mg-bar"><i style={{ width: `${Math.min(100, (profile.balance / office.price) * 100)}%` }} /></div>
          <small>{vkr(profile.balance)} / {vkr(office.price)}</small>
          <button className="button button-primary" disabled={profile.balance < office.price} onClick={() => setConfirmAsset(office)}>
            {profile.balance < office.price ? `Mangler ${vkr(office.price - profile.balance)}` : `Køb for ${vkr(office.price)}`}
          </button>
        </div>}
        <div className="panel mg-earn">
          <span className="panel-eyebrow">SÅDAN TJENER DU VIRTUELLE KRONER</span>
          <ul>
            <li><span>Kvalificeret møde godkendt af admin</span><strong>+{vkr(state.rewards.meeting_approved)}</strong></li>
            <li><span>Møde afholdt og godkendt af partneren</span><strong>+{vkr(state.rewards.meeting_held)}</strong></li>
            <li><span>Betalende kunde godkendt af admin</span><strong>+{vkr(state.rewards.sale_approved)}</strong></li>
            <li><span>Mersalg godkendt af admin</span><strong>+{vkr(state.rewards.upsell_approved)}</strong></li>
            <li><span>Missioner og achievements</span><strong>Bonus</strong></li>
          </ul>
          <p className="mg-fineprint">Virtuelle kroner er spilvaluta og kan ikke udbetales. De påvirker ikke din provision.</p>
        </div>
        <div className="panel mg-owned">
          <span className="panel-eyebrow">DIN VIRKSOMHED · {state.inventory.length} AKTIVER</span>
          {state.inventory.length ? <ul>{state.inventory.map((item) => <li key={item.id}>
            <span>{assetByKey.get(item.asset_key)?.name ?? item.asset_key}{item.listed && <em> · til salg</em>}</span>
            <small>{vkr(assetByKey.get(item.asset_key)?.value ?? 0)}</small>
          </li>)}</ul> : <p className="mg-fineprint">Grunden er tom. Dit første kontor bliver bygget her.</p>}
          <div className="mg-profile-stats">
            <span>Godkendte møder <strong>{state.stats.approved_meetings}</strong></span>
            <span>Godkendte salg <strong>{state.stats.approved_sales}</strong></span>
          </div>
        </div>
      </aside>
    </section>}

    {tab === "shop" && <ShopView state={state} onBuy={setConfirmAsset} />}
    {tab === "missions" && <MissionsView state={state} />}
    {tab === "market" && <MarketView key={marketView} initialView={marketView} state={state} assetByKey={assetByKey} onChanged={load} onPublicChange={(value) => void saveProfile({ public_profile: value })} />}
    {tab === "history" && <section className="panel mg-history">
      <span className="panel-eyebrow">TRANSAKTIONER · SENESTE 30</span>
      {state.transactions.length ? <ul>{state.transactions.map((transaction) => <li key={transaction.id}>
        <span><strong>{transaction.description}</strong><small>{new Date(transaction.created_at).toLocaleString("da-DK", { dateStyle: "medium", timeStyle: "short" })}</small></span>
        <b className={transaction.amount >= 0 ? "mg-plus" : "mg-minus"}>{transaction.amount >= 0 ? "+" : ""}{vkr(transaction.amount)}</b>
        <small>Saldo {vkr(transaction.balance_after)}</small>
      </li>)}</ul> : <p className="mg-fineprint">Ingen transaktioner endnu. Dine belønninger og køb vises her.</p>}
    </section>}

    {confirmAsset && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmAsset(null); }}>
      <section className="modal-card mg-confirm" role="dialog" aria-modal="true" aria-labelledby="mg-confirm-title">
        <div className="modal-header"><div><span className="eyebrow">BEKRÆFT KØB</span><h2 id="mg-confirm-title">{confirmAsset.name}</h2></div></div>
        <p>{confirmAsset.description}</p>
        <dl className="mg-confirm-lines">
          <div><dt>Pris</dt><dd>{vkr(confirmAsset.price)}</dd></div>
          <div><dt>Saldo efter køb</dt><dd>{vkr(profile.balance - confirmAsset.price)}</dd></div>
          <div><dt>Værdi i virksomheden</dt><dd>{vkr(confirmAsset.value)}</dd></div>
        </dl>
        <div className="modal-actions"><button className="button button-secondary" onClick={() => setConfirmAsset(null)} disabled={busy}>Annuller</button>
          <button className="button button-primary" onClick={() => void buy(confirmAsset)} disabled={busy}>{busy ? "Køber …" : `Køb for ${vkr(confirmAsset.price)}`}</button></div>
      </section>
    </div>}

    {levelUp && <div className="mg-levelup" role="alert" onClick={() => setLevelUp(null)}>
      <div className="mg-levelup-card"><Crown size={34} /><span>LEVEL UP</span><strong>Level {levelUp.level} · {levelUp.title}</strong><p>{levelUp.description}</p>
        <button className="button mg-button-gold" onClick={() => setLevelUp(null)}>Fortsæt</button></div>
    </div>}
  </div>;
}

function GameHeader() {
  return <div className="mg-title"><span className="mg-logo"><Crown size={22} /></span><div><h1>MAGNORA EMPIRE</h1><p>Build your business. Grow your empire.</p></div></div>;
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Coins; label: string; value: string; tone: string }) {
  return <div className={`mg-stat mg-tone-${tone}`}><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>;
}

function ShopView({ state, onBuy }: { state: GameState; onBuy: (asset: GameAsset) => void }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const owned = (key: string) => state.inventory.filter((item) => item.asset_key === key).length;
  const categories = [...new Set(state.assets.map((asset) => asset.category))];
  const visible = state.assets.filter((asset) => (category === "all" || asset.category === category)
    && (!query || asset.name.toLocaleLowerCase("da-DK").includes(query.toLocaleLowerCase("da-DK"))));
  return <section className="mg-shop">
    <div className="mg-toolbar">
      <div className="mg-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg i butikken" aria-label="Søg i butikken" /></div>
      <div className="mg-chips"><button className={category === "all" ? "mg-chip-active" : ""} onClick={() => setCategory("all")}>Alle</button>
        {categories.map((key) => <button key={key} className={category === key ? "mg-chip-active" : ""} onClick={() => setCategory(key)}>{categoryLabels[key] ?? key}</button>)}</div>
    </div>
    <div className="mg-asset-grid">{visible.map((asset) => {
      const count = owned(asset.key);
      const locked = state.profile.level < asset.min_level;
      const maxed = asset.max_per_user !== null && count >= asset.max_per_user;
      const affordable = state.profile.balance >= asset.price;
      return <article key={asset.key} className={`mg-asset ${locked ? "mg-asset-locked" : ""}`}>
        <div className={`mg-asset-art mg-art-${asset.art}`}>{locked ? <Lock size={22} /> : <Building2 size={22} />}</div>
        <span className="mg-asset-cat">{categoryLabels[asset.category] ?? asset.category}</span>
        <h3>{asset.name}</h3>
        <p>{asset.description}</p>
        <dl><div><dt>Pris</dt><dd>{vkr(asset.price)}</dd></div><div><dt>Værdi</dt><dd>{vkr(asset.value)}</dd></div>
          <div><dt>Ejer</dt><dd>{count}{asset.max_per_user ? ` / ${asset.max_per_user}` : ""}</dd></div></dl>
        <button className="button button-primary" disabled={locked || maxed || !affordable} onClick={() => onBuy(asset)}>
          {locked ? `Kræver level ${asset.min_level}` : maxed ? "Maks. antal ejet" : affordable ? "Køb" : `Mangler ${vkr(asset.price - state.profile.balance)}`}
        </button>
      </article>;
    })}</div>
  </section>;
}

function missionProgress(achievement: Achievement, state: GameState): [number, number] | null {
  const target = Number(achievement.threshold);
  switch (achievement.requirement_type) {
    case "approved_meetings": return [state.stats.approved_meetings, target];
    case "lifetime_earned": return [state.profile.lifetime_earned, target];
    case "assets_owned": return [state.inventory.length, target];
    case "verified_earnings": return [state.profile.verified_earnings_dkk, target];
    case "level": return [state.profile.level, target];
    default: return null;
  }
}

function MissionsView({ state }: { state: GameState }) {
  const done = state.achievements.filter((achievement) => achievement.completed_at).length;
  return <section className="mg-missions">
    <div className="mg-missions-head"><Award size={18} /><strong>{done} af {state.achievements.length} missioner gennemført</strong></div>
    <div className="mg-mission-grid">{state.achievements.map((achievement) => {
      const progress = missionProgress(achievement, state);
      return <article key={achievement.key} className={`mg-mission ${achievement.completed_at ? "mg-mission-done" : ""}`}>
        <span className="mg-mission-icon">{achievement.completed_at ? <Trophy size={18} /> : <Target size={18} />}</span>
        <div><h3>{achievement.title}</h3><p>{achievement.description}</p>
          {progress && !achievement.completed_at && <><div className="mg-bar"><i style={{ width: `${Math.min(100, (progress[0] / Math.max(1, progress[1])) * 100)}%` }} /></div>
            <small>{Math.min(progress[0], progress[1]).toLocaleString("da-DK")} / {progress[1].toLocaleString("da-DK")}</small></>}
          <small className="mg-mission-meta">{achievement.completed_at
            ? `Gennemført ${new Date(achievement.completed_at).toLocaleDateString("da-DK")}`
            : "Ikke gennemført"} · Belønning {vkr(achievement.reward)}</small>
        </div>
        {achievement.completed_at && <TrendingUp size={16} className="mg-mission-check" />}
      </article>;
    })}</div>
  </section>;
}
