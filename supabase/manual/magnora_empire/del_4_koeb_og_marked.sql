-- Magnora Empire database, del 4 af 4. Kør delene i rækkefølge i Supabase SQL Editor.
-- Samme indhold som supabase/migrations/20261010100000_magnora_empire_game.sql.

create or replace function nordcall.game_buy_asset(p_user uuid, p_asset_key text, p_request_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  asset nordcall.game_assets;
  owned int;
  inserted uuid;
begin
  perform nordcall.game_ensure_profile(p_user);
  select * into player from nordcall.game_profiles where user_id = p_user for update;
  if exists (select 1 from nordcall.game_transactions where user_id = p_user and kind = 'purchase' and ref = p_request_id::text) then
    return 'duplicate';
  end if;
  select * into asset from nordcall.game_assets where key = p_asset_key and active;
  if asset.key is null then return 'unknown_asset'; end if;
  if player.level < asset.min_level then return 'level_too_low'; end if;
  select count(*) into owned from nordcall.game_inventory where owner_id = p_user and asset_key = asset.key;
  if asset.max_per_user is not null and owned >= asset.max_per_user then return 'limit_reached'; end if;
  if player.balance < asset.price then return 'insufficient_funds'; end if;

  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (p_user, player.team_id, 'purchase', -asset.price, player.balance - asset.price, p_request_id::text, 'Købt: ' || asset.name)
  on conflict (user_id, kind, ref) do nothing
  returning id into inserted;
  if inserted is null then return 'duplicate'; end if;
  insert into nordcall.game_inventory (owner_id, team_id, asset_key, acquired_price, acquired_via)
  values (p_user, player.team_id, asset.key, asset.price, 'shop');
  update nordcall.game_profiles set balance = balance - asset.price, updated_at = now() where user_id = p_user;
  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_evaluate_achievements(p_user);
  return 'ok';
end;
$$;

create or replace function nordcall.game_market_list(p_user uuid, p_inventory_id uuid, p_price bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  item record;
begin
  select * into player from nordcall.game_profiles where user_id = p_user for update;
  if player.user_id is null or player.market_unlocked_at is null then return 'market_locked'; end if;
  if p_price is null or p_price < 1 or p_price > 100000000 then return 'invalid_price'; end if;
  select i.id, i.asset_key, a.transferable into item
  from nordcall.game_inventory i join nordcall.game_assets a on a.key = i.asset_key
  where i.id = p_inventory_id and i.owner_id = p_user for update of i;
  if item.id is null then return 'not_owner'; end if;
  if not item.transferable then return 'not_transferable'; end if;
  if exists (select 1 from nordcall.game_market_listings where inventory_id = item.id and status = 'active') then return 'already_listed'; end if;
  insert into nordcall.game_market_listings (team_id, seller_id, inventory_id, asset_key, price)
  values (player.team_id, p_user, item.id, item.asset_key, p_price);
  return 'ok';
end;
$$;

create or replace function nordcall.game_market_cancel(p_user uuid, p_listing_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update nordcall.game_market_listings set status = 'cancelled', closed_at = now()
  where id = p_listing_id and seller_id = p_user and status = 'active';
  return case when found then 'ok' else 'not_found' end;
end;
$$;

create or replace function nordcall.game_market_buy(p_user uuid, p_listing_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  listing nordcall.game_market_listings;
  buyer nordcall.game_profiles;
  seller nordcall.game_profiles;
  asset nordcall.game_assets;
  owned int;
begin
  select * into listing from nordcall.game_market_listings where id = p_listing_id for update;
  if listing.id is null or listing.status <> 'active' then return 'not_available'; end if;
  if listing.seller_id = p_user then return 'own_listing'; end if;

  -- Lock both players in a fixed order so concurrent trades cannot deadlock.
  perform 1 from nordcall.game_profiles where user_id in (p_user, listing.seller_id) order by user_id for update;
  select * into buyer from nordcall.game_profiles where user_id = p_user;
  select * into seller from nordcall.game_profiles where user_id = listing.seller_id;
  if buyer.user_id is null or buyer.market_unlocked_at is null then return 'market_locked'; end if;
  if buyer.team_id <> listing.team_id then return 'not_available'; end if;
  if not exists (select 1 from nordcall.game_inventory where id = listing.inventory_id and owner_id = listing.seller_id) then
    update nordcall.game_market_listings set status = 'cancelled', closed_at = now() where id = listing.id;
    return 'not_available';
  end if;
  select * into asset from nordcall.game_assets where key = listing.asset_key;
  select count(*) into owned from nordcall.game_inventory where owner_id = p_user and asset_key = asset.key;
  if asset.max_per_user is not null and owned >= asset.max_per_user then return 'limit_reached'; end if;
  if buyer.balance < listing.price then return 'insufficient_funds'; end if;

  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (p_user, buyer.team_id, 'market_buy', -listing.price, buyer.balance - listing.price, listing.id::text, 'Købt på Magnora Market: ' || asset.name);
  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (seller.user_id, seller.team_id, 'market_sale', listing.price, seller.balance + listing.price, listing.id::text, 'Solgt på Magnora Market: ' || asset.name);
  update nordcall.game_profiles set balance = balance - listing.price, updated_at = now() where user_id = p_user;
  update nordcall.game_profiles set balance = balance + listing.price, updated_at = now() where user_id = seller.user_id;
  update nordcall.game_inventory set owner_id = p_user, acquired_price = listing.price, acquired_via = 'market', acquired_at = now()
  where id = listing.inventory_id;
  update nordcall.game_market_listings set status = 'sold', buyer_id = p_user, closed_at = now() where id = listing.id;

  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_recompute_level(seller.user_id);
  perform nordcall.game_evaluate_achievements(p_user);
  perform nordcall.game_evaluate_achievements(seller.user_id);
  return 'ok';
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'game_config_value(text, numeric)', 'game_ensure_profile(uuid)', 'game_credit(uuid, bigint, text, text, text)',
    'game_recompute_level(uuid)', 'game_evaluate_achievements(uuid)', 'game_sync(uuid)',
    'game_buy_asset(uuid, text, uuid)', 'game_market_list(uuid, uuid, bigint)', 'game_market_cancel(uuid, uuid)',
    'game_market_buy(uuid, uuid)'] loop
    execute format('revoke all on function nordcall.%s from public, anon, authenticated', f);
    execute format('grant execute on function nordcall.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
