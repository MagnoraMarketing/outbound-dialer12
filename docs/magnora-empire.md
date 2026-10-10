# Magnora Empire

A business-tycoon game for team members, opened from **Spil** at the bottom of the sidebar. It uses the existing login; there is no separate game account.

## Money model

Three kinds of value are kept apart and never added together:

| Value | Where it lives | Who can change it |
| --- | --- | --- |
| Verified sales earnings (DKK) | Sum of `amount_dkk` in `nordcall.earning_approvals` with `status = 'approved'` | Administrators, on **Godkend indtjening** |
| Virtual kroner (vkr.) | `nordcall.game_profiles.balance` plus the ledger in `nordcall.game_transactions` | Database functions only |
| Company value, net worth, XP, level | Derived from owned assets and the ledger | Database functions only |

Virtual kroner have no value outside the game and do not change commission.

### Why earnings need an administrator

Before the game, the platform had no verified DKK earnings:

- **Sales** (`budget_events` with `event_type = 'sale'`) are recorded by the seller and nothing approves them.
- **Commission rates** (`sales_targets.commission_per_meeting` and `commission_per_sale`) can be edited by a seller on their own budget.

Using either directly would let a seller unlock Magnora Market without anyone checking. The game therefore adds `nordcall.earning_approvals`:

1. An administrator opens **Godkend indtjening**. It lists the team's meetings and recorded sales from the last 180 days, together with the partner's status for each meeting.
2. The suggested DKK amount is the commission rate from the seller's budget for that campaign. The administrator confirms or corrects it, then approves or rejects.
3. Each meeting or sale can have one decision (`unique (source_type, source_id)`). Changing a decision replaces it, so earnings are never counted twice.

**Needs clarification with the business:** whether the DKK basis should be commission (as suggested here) or revenue, and whether commission rates should be locked to administrators.

## Game rewards (virtual kroner)

The rewards are configurable in `nordcall.game_config`. Each is paid once per event; the event key is the unique `ref` in the ledger.

| Event | Verified by | Default | Ledger ref |
| --- | --- | --- | --- |
| Qualified meeting booked and approved | Administrator approval of the meeting | 500 | `meeting_approved:<meeting id>` |
| Meeting held and approved | Partner status *Godt møde* or *Mindre godt møde* in the partner portal | 500 | `meeting_held:<meeting id>` |
| Paying customer approved | Administrator approval of the sale | 1.000 | `sale_approved:<budget event id>` |
| Missions and achievements | `nordcall.game_achievements` | per mission | `<achievement key>` |

One booking can therefore earn all three meeting/sale rewards, but each only once.

## Magnora Market access

- **Rule:** a player becomes ready when `verified_earnings_dkk >= game_config.market_unlock_dkk` (50.000 by default).
- **Ready, then unlock:** `nordcall.game_sync` stores `market_ready_at` the first time the threshold is reached. The whole team sees a banner. The player then presses "Lås Magnora Market op" (`nordcall.game_market_unlock`), which sets `market_unlocked_at`. The player then starts their first shop by listing an asset.
- **Permanent access:** neither timestamp is ever cleared, so a later correction to an approval does not remove access.
- **Upsell (mersalg):** sellers register an upsell in Budget. An approved upsell gives `reward_upsell_approved` (2.000 vkr. by default), and the first one completes the "First Upsell" mission (2.500 vkr.).
- **Server-side checks:** every market route checks access on the server, and the database functions check it again. Virtual balance, company value and trades in the game never count toward the threshold.

## Levels and assets

- **Levels** live in `nordcall.game_levels`. A level requires a minimum company value (the sum of the catalogue value of owned assets) and, from level 2, owning the first office.
- **Assets** live in `nordcall.game_assets`: price, value, minimum level, per-player limit, whether the asset can be traded, and its artwork key.
- **The first office** costs 5.000 vkr. and is limited to one per player.

You can change prices, levels, rewards and missions by updating these tables. No code change is needed.

## Security

- **No browser access:** all game tables and `earning_approvals` have RLS enabled, and every privilege is revoked from `anon` and `authenticated`. Browsers cannot read or write them directly.
- **Server routes only:** the routes in `src/app/api/game/*` and `src/app/api/admin/earnings` authenticate the user with the existing session, then call `security definer` functions with the service role. Those functions are executable only by `service_role`.
- **Purchases:** `game_buy_asset` locks the player row, checks level, limit and balance, and is idempotent per `request_id`.
- **Market trades:** `game_market_buy` locks the listing, then both players in a fixed order. It checks access, ownership and balance, then moves money and ownership in one transaction, writing both sides to the ledger.
- **Public profiles:** these show company name, level, XP, company value, buildings and achievements. DKK earnings, commission and CRM data are never shared.
- **Partner logins:** these have no team profile and cannot open the game.

## Implemented and not implemented

| Area | Status |
| --- | --- |
| My Empire: profile, levels, shop, isometric city, missions, history | Implemented |
| Magnora Market: listings, search and filters, buying, own listings, trade history, player profiles | Implemented |
| Selling a whole virtual company (function B) | Not implemented. Moving every asset and reference in one step needs its own design; buying and selling single assets covers the trading. |
| Investments (function C) and partnerships (function D) | Not implemented. Ownership shares and shared projects need clear valuation and exit rules. The prompt asks not to ship a partial version. |

## Tests

- `supabase/tests/magnora_empire_test.sql` contains self-checking tests that run in a rolled-back transaction. They cover requirements 1, 4–17.
- `supabase/tests/magnora_empire_concurrency.sh` runs parallel buyers of one listing, and parallel purchases with money for only some of them (requirement 18).

Run both against a disposable database with all migrations applied.
