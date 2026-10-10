"use client";

import { ArrowRight, Building2, Crown, Lock, Search, Store, Tag, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { categoryLabels, dkk, vkr, type GameAsset, type GameState } from "@/components/game/game-types";

type ListingAsset = { name: string; description: string; category: string; value: number; min_level: number; art: string };
type Listing = { id: string; seller_id: string; inventory_id: string; asset_key: string; price: number; created_at: string; asset: ListingAsset; seller: { company_name: string; level: number } | null; own: boolean };
type Trade = { id: string; asset_key: string; price: number; status: string; created_at: string; closed_at: string | null; asset: ListingAsset; role: "seller" | "buyer"; counterparty: string | null };
type Player = { user_id: string; company_name: string; level: number; xp: number };
type MarketData = { listings: Listing[]; history: Trade[]; players: Player[] };
type PublicProfile = { company_name: string; level: number; xp: number; company_value: number; assets: string[]; achievements: { achievement_key: string }[] };

async function marketApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

export function MarketView({ state, assetByKey, onChanged, onPublicChange, initialView = "listings" }: {
  initialView?: "listings" | "mine";
  state: GameState; assetByKey: Map<string, GameAsset>; onChanged: () => Promise<void>; onPublicChange: (value: boolean) => void;
}) {
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<"listings" | "mine" | "history" | "players">(initialView);
  const [confirm, setConfirm] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [sellItem, setSellItem] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await marketApi<MarketData>("/api/game/market"));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Markedet kunne ikke indlæses.");
    }
  }, []);
  useEffect(() => { if (state.market.unlocked) void load(); }, [state.market.unlocked, load]);

  if (!state.market.unlocked) {
    return <section className="mg-market-locked">
      <span className="mg-lock-big"><Lock size={28} /></span>
      <h2>Magnora Market er låst</h2>
      <p>Markedet åbner, når du har <strong>{dkk(state.market.threshold_dkk)}</strong> i godkendt, kumulativ salgsindtjening. Virtuelle kroner, virksomhedsværdi og handler i spillet tæller ikke med.</p>
      <div className="mg-bar mg-bar-gold"><i style={{ width: `${state.market.percent}%` }} /></div>
      <small>{dkk(state.profile.verified_earnings_dkk)} godkendt · {dkk(state.market.remaining_dkk)} tilbage</small>
      <div className="mg-market-teaser">
        <div><Store size={18} /><strong>Køb og sælg aktiver</strong><span>Handl bygninger og kontorer med kolleger, der også har låst markedet op.</span></div>
        <div><UserRound size={18} /><strong>Offentlig profil</strong><span>Vis din virksomhed for andre spillere. Din provision og CRM-data deles aldrig.</span></div>
        <div><Crown size={18} /><strong>Market Unlocked</strong><span>Belønning på {vkr(state.achievements.find((achievement) => achievement.key === "market_unlocked")?.reward ?? 0)} når du låser op.</span></div>
      </div>
    </section>;
  }

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(success);
      await Promise.all([load(), onChanged()]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Handlingen mislykkedes.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const sellable = state.inventory.filter((item) => !item.listed && assetByKey.get(item.asset_key)?.transferable);
  const listings = (data?.listings ?? []).filter((listing) => !listing.own
    && (category === "all" || listing.asset.category === category)
    && (!query || `${listing.asset.name} ${listing.seller?.company_name ?? ""}`.toLocaleLowerCase("da-DK").includes(query.toLocaleLowerCase("da-DK"))));
  const mine = (data?.listings ?? []).filter((listing) => listing.own);
  const categories = [...new Set((data?.listings ?? []).map((listing) => listing.asset.category))];

  return <section className="mg-market">
    {(error || notice) && <div className={`mg-inline-msg ${error ? "mg-inline-error" : ""}`} role="status">{error || notice}
      <button aria-label="Luk" onClick={() => { setError(""); setNotice(""); }}><X size={14} /></button></div>}
    <div className="mg-market-head">
      <div className="mg-chips">{([["listings", "Annoncer"], ["mine", `Mine annoncer (${mine.length})`], ["history", "Handelshistorik"], ["players", "Spillere"]] as const).map(([key, label]) =>
        <button key={key} className={view === key ? "mg-chip-active" : ""} onClick={() => setView(key)}>{label}</button>)}</div>
      <label className="mg-public"><input type="checkbox" checked={state.profile.public_profile} onChange={(event) => onPublicChange(event.target.checked)} /> Offentlig profil</label>
    </div>

    {view === "listings" && <>
      <div className="mg-toolbar">
        <div className="mg-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg aktiv eller sælger" aria-label="Søg i annoncer" /></div>
        <div className="mg-chips"><button className={category === "all" ? "mg-chip-active" : ""} onClick={() => setCategory("all")}>Alle</button>
          {categories.map((key) => <button key={key} className={category === key ? "mg-chip-active" : ""} onClick={() => setCategory(key)}>{categoryLabels[key] ?? key}</button>)}</div>
      </div>
      {!data ? <p className="mg-fineprint">Henter annoncer …</p> : listings.length ? <div className="mg-asset-grid">{listings.map((listing) => {
        const tooLow = state.profile.level < listing.asset.min_level;
        return <article key={listing.id} className="mg-asset">
          <div className={`mg-asset-art mg-art-${listing.asset.art}`}><Building2 size={22} /></div>
          <span className="mg-asset-cat">{listing.seller?.company_name ?? "Sælger"} · Level {listing.seller?.level ?? "?"}</span>
          <h3>{listing.asset.name}</h3><p>{listing.asset.description}</p>
          <dl><div><dt>Pris</dt><dd>{vkr(listing.price)}</dd></div><div><dt>Katalogværdi</dt><dd>{vkr(listing.asset.value)}</dd></div>
            <div><dt>Status</dt><dd>Til salg</dd></div></dl>
          {tooLow && <small className="mg-fineprint">Anbefalet level {listing.asset.min_level}</small>}
          <button className="button button-primary" disabled={busy || state.profile.balance < listing.price} onClick={() => setConfirm(listing)}>
            {state.profile.balance < listing.price ? `Mangler ${vkr(listing.price - state.profile.balance)}` : "Køb"}</button>
        </article>;
      })}</div> : <div className="panel mg-market-intro"><Store size={22} /><h3>Ingen annoncer endnu</h3>
        <p>Magnora Market er stedet, hvor kvalificerede spillere handler virtuelle bygninger med hinanden. Sæt et af dine aktiver til salg under <strong>Mine annoncer</strong>, eller kom tilbage, når flere kolleger har låst markedet op.</p></div>}
    </>}

    {view === "mine" && <div className="mg-market-split">
      <div className="panel mg-sell">
        <span className="panel-eyebrow">{mine.length || data?.history.length ? "SÆT ET AKTIV TIL SALG" : "START DIN FØRSTE BUTIK"}</span>
        {!mine.length && !data?.history.length && <p className="mg-fineprint">Din butik på Magnora Market åbner, når du sætter dit første aktiv til salg. Kolleger, der også har låst markedet op, kan købe det.</p>}
        {sellable.length ? <form onSubmit={(event) => {
          event.preventDefault();
          const price = Number(sellPrice);
          void act(() => marketApi("/api/game/market", { method: "POST", body: JSON.stringify({ inventory_id: sellItem, price }) }), "Din annonce er oprettet.")
            .then(() => { setSellItem(""); setSellPrice(""); });
        }}>
          <label>Aktiv<select required value={sellItem} onChange={(event) => setSellItem(event.target.value)}>
            <option value="">Vælg aktiv …</option>{sellable.map((item) => <option key={item.id} value={item.id}>{assetByKey.get(item.asset_key)?.name} · værdi {vkr(assetByKey.get(item.asset_key)?.value ?? 0)}</option>)}
          </select></label>
          <label>Pris (virtuelle kroner)<input required type="number" min={1} step={1} value={sellPrice} onChange={(event) => setSellPrice(event.target.value)} /></label>
          <p className="mg-fineprint">Aktivet bliver i din virksomhed, indtil det bliver solgt. Sælger du dit første kontor, kan dit level falde.</p>
          <button className="button button-primary" disabled={busy}><Tag size={15} /> Sæt til salg</button>
        </form> : <p className="mg-fineprint">Du har ingen aktiver, der kan sættes til salg lige nu.</p>}
      </div>
      <div className="panel mg-my-listings">
        <span className="panel-eyebrow">AKTIVE ANNONCER</span>
        {mine.length ? <ul>{mine.map((listing) => <li key={listing.id}><span><strong>{listing.asset.name}</strong><small>{vkr(listing.price)}</small></span>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(() => marketApi(`/api/game/market?id=${listing.id}`, { method: "DELETE" }), "Annoncen er trukket tilbage.")}>Træk tilbage</button></li>)}</ul>
          : <p className="mg-fineprint">Du har ingen aktive annoncer.</p>}
      </div>
    </div>}

    {view === "history" && <div className="panel mg-history">
      <span className="panel-eyebrow">AFSLUTTEDE HANDLER OG ANNONCER</span>
      {data?.history.length ? <ul>{data.history.map((trade) => <li key={trade.id}>
        <span><strong>{trade.asset.name}</strong><small>{trade.status === "sold" ? `${trade.role === "seller" ? "Solgt til" : "Købt af"} ${trade.counterparty ?? "en spiller"}` : "Annonce trukket tilbage"} · {new Date(trade.closed_at ?? trade.created_at).toLocaleDateString("da-DK")}</small></span>
        <b className={trade.status !== "sold" ? "" : trade.role === "seller" ? "mg-plus" : "mg-minus"}>{trade.status === "sold" ? `${trade.role === "seller" ? "+" : "-"}${vkr(trade.price)}` : "—"}</b>
      </li>)}</ul> : <p className="mg-fineprint">Ingen afsluttede handler endnu.</p>}
    </div>}

    {view === "players" && <div className="mg-players">{data?.players.length ? data.players.map((player) =>
      <button key={player.user_id} className="panel mg-player" onClick={() => void marketApi<{ data: PublicProfile }>(`/api/game/players/${player.user_id}`).then((result) => setProfile(result.data)).catch((profileError) => setError(profileError.message))}>
        <span className="mg-player-avatar"><Crown size={16} /></span><span><strong>{player.company_name}</strong><small>Level {player.level} · {player.xp.toLocaleString("da-DK")} XP</small></span><ArrowRight size={15} />
      </button>) : <p className="mg-fineprint">Du er den første på markedet. Andre spillere vises her, når de låser op og har en offentlig profil.</p>}</div>}

    {confirm && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirm(null); }}>
      <section className="modal-card mg-confirm" role="dialog" aria-modal="true" aria-labelledby="mg-market-confirm">
        <div className="modal-header"><div><span className="eyebrow">BEKRÆFT HANDEL</span><h2 id="mg-market-confirm">{confirm.asset.name}</h2></div></div>
        <dl className="mg-confirm-lines"><div><dt>Sælger</dt><dd>{confirm.seller?.company_name ?? "Spiller"}</dd></div>
          <div><dt>Pris</dt><dd>{vkr(confirm.price)}</dd></div><div><dt>Saldo efter køb</dt><dd>{vkr(state.profile.balance - confirm.price)}</dd></div></dl>
        <div className="modal-actions"><button className="button button-secondary" onClick={() => setConfirm(null)} disabled={busy}>Annuller</button>
          <button className="button button-primary" disabled={busy} onClick={() => void act(() => marketApi("/api/game/market/buy", { method: "POST", body: JSON.stringify({ listing_id: confirm.id }) }), `Du har købt ${confirm.asset.name}.`)}>{busy ? "Handler …" : "Gennemfør handel"}</button></div>
      </section>
    </div>}

    {profile && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfile(null); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="mg-profile-title">
        <div className="modal-header"><div><span className="eyebrow">OFFENTLIG PROFIL</span><h2 id="mg-profile-title">{profile.company_name}</h2></div>
          <button className="icon-button" aria-label="Luk" onClick={() => setProfile(null)}><X size={17} /></button></div>
        <dl className="mg-confirm-lines"><div><dt>Level</dt><dd>{profile.level}</dd></div><div><dt>XP</dt><dd>{profile.xp.toLocaleString("da-DK")}</dd></div>
          <div><dt>Virksomhedsværdi</dt><dd>{vkr(profile.company_value)}</dd></div><div><dt>Achievements</dt><dd>{profile.achievements.length}</dd></div></dl>
        <div className="pt-chips">{profile.assets.map((key, index) => <span className="pt-chip" key={`${key}-${index}`}>{assetByKey.get(key)?.name ?? key}</span>)}</div>
      </section>
    </div>}
  </section>;
}
