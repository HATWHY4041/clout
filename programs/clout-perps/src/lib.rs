//! Clout Perps: perpetual futures on a token's Clout Score (a 0–100 hype meter).
//!
//! Pool model (like JLP / GLP): traders trade against a shared USDC pool.
//! - An oracle (the Clout house) pushes each market's Clout Score on-chain.
//! - Go long (hype up) or short (hype down) with 1–5x leverage. No expiry.
//! - Funding: the heavier side pays the lighter side, up to 0.10%/hour at full skew.
//! - Positions with equity under 5% of size can be liquidated by anyone.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("2TnMRv2z42aBnxSFFefSd71sYNreRrtUR2oSVJf3cP3W");

pub const PRICE_SCALE: u64 = 1_000_000; // price = score * 1e6
pub const FUNDING_SCALE: i128 = 1_000_000_000_000; // funding index units per 1.0 of notional
pub const MAX_FUNDING_BPS_PER_HOUR: i128 = 10; // 0.10%/h at 100% skew
pub const OPEN_FEE_BPS: u64 = 10; // 0.10% of size
pub const MAINT_BPS: u64 = 500; // 5% of size
pub const LIQ_REWARD_BPS: u64 = 50; // 0.5% of size, paid from remaining equity
pub const MAX_STALENESS_SECS: i64 = 20 * 60;
pub const MIN_PRICE: u64 = PRICE_SCALE; // score floor of 1.0

#[program]
pub mod clout_perps {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, oracle: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.oracle = oracle;
        c.mint = ctx.accounts.mint.key();
        c.vault = ctx.accounts.vault.key();
        c.bump = ctx.bumps.config;
        c.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn create_market(ctx: Context<CreateMarket>, token: Pubkey, symbol: String, price: u64, max_leverage: u8) -> Result<()> {
        require!(symbol.len() <= 12, PerpsError::BadInput);
        require!((1..=10).contains(&max_leverage), PerpsError::BadInput);
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        m.token = token;
        let mut sym = [0u8; 12];
        sym[..symbol.len()].copy_from_slice(symbol.as_bytes());
        m.symbol = sym;
        m.price = price.max(MIN_PRICE);
        m.updated_at = now;
        m.oi_long = 0;
        m.oi_short = 0;
        m.funding_index = 0;
        m.last_funding_ts = now;
        m.max_leverage = max_leverage;
        m.bump = ctx.bumps.market;
        emit!(PriceUpdated { market: m.key(), price: m.price, ts: now });
        Ok(())
    }

    /// Oracle pushes the latest Clout Score (scaled by 1e6).
    pub fn update_price(ctx: Context<UpdatePrice>, price: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        accrue_funding(m, now)?;
        m.price = price.max(MIN_PRICE);
        m.updated_at = now;
        emit!(PriceUpdated { market: m.key(), price: m.price, ts: now });
        Ok(())
    }

    /// Add USDC to the pool that backs trader profits (anyone can top it up).
    pub fn fund_pool(ctx: Context<FundPool>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpsError::BadInput);
        transfer_in(&ctx.accounts.funder_token, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.funder, &ctx.accounts.token_program, amount)
    }

    pub fn open_position(ctx: Context<OpenPosition>, is_long: bool, collateral: u64, leverage: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        require!(now - m.updated_at <= MAX_STALENESS_SECS, PerpsError::StalePrice);
        require!(leverage >= 1 && leverage <= m.max_leverage, PerpsError::BadLeverage);
        require!(collateral >= 1_000_000, PerpsError::TooSmall); // ≥ 1 USDC
        accrue_funding(m, now)?;

        transfer_in(&ctx.accounts.owner_token, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.owner, &ctx.accounts.token_program, collateral)?;

        let size = collateral.checked_mul(leverage as u64).ok_or(PerpsError::MathOverflow)?;
        let fee = size * OPEN_FEE_BPS / 10_000;
        let net = collateral.checked_sub(fee).ok_or(PerpsError::TooSmall)?;

        let p = &mut ctx.accounts.position;
        p.owner = ctx.accounts.owner.key();
        p.market = m.key();
        p.is_long = is_long;
        p.collateral = net;
        p.size = size;
        p.entry_price = m.price;
        p.entry_funding = m.funding_index;
        p.opened_at = now;
        p.bump = ctx.bumps.position;

        if is_long { m.oi_long += size } else { m.oi_short += size }
        emit!(PositionOpened { owner: p.owner, market: p.market, is_long, collateral: net, size, price: m.price });
        Ok(())
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        accrue_funding(m, now)?;
        let p = &ctx.accounts.position;
        let eq = equity(p, m)?;
        let available = ctx.accounts.vault.amount as i128;
        let payout = eq.max(0).min(available) as u64;
        remove_oi(m, p);
        if payout > 0 {
            transfer_out(&ctx.accounts.vault, &ctx.accounts.owner_token, &ctx.accounts.mint, &ctx.accounts.config, &ctx.accounts.token_program, payout)?;
        }
        emit!(PositionClosed { owner: p.owner, market: p.market, payout, price: m.price, liquidated: false });
        Ok(())
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        accrue_funding(m, now)?;
        let p = &ctx.accounts.position;
        let eq = equity(p, m)?;
        let maint = (p.size * MAINT_BPS / 10_000) as i128;
        require!(eq < maint, PerpsError::NotLiquidatable);
        let reward = eq.max(0).min((p.size * LIQ_REWARD_BPS / 10_000) as i128) as u64;
        remove_oi(m, p);
        if reward > 0 {
            transfer_out(&ctx.accounts.vault, &ctx.accounts.liquidator_token, &ctx.accounts.mint, &ctx.accounts.config, &ctx.accounts.token_program, reward)?;
        }
        emit!(PositionClosed { owner: p.owner, market: p.market, payout: 0, price: m.price, liquidated: true });
        Ok(())
    }
}

// ---------------------------------------------------------------- math

fn accrue_funding(m: &mut Market, now: i64) -> Result<()> {
    let dt = (now - m.last_funding_ts).max(0) as i128;
    let total = m.oi_long as i128 + m.oi_short as i128;
    if dt > 0 && total > 0 {
        let skew = m.oi_long as i128 - m.oi_short as i128;
        let delta = MAX_FUNDING_BPS_PER_HOUR * FUNDING_SCALE / 10_000 * skew / total * dt / 3600;
        m.funding_index = m.funding_index.checked_add(delta).ok_or(PerpsError::MathOverflow)?;
    }
    m.last_funding_ts = now;
    Ok(())
}

/// Collateral + PnL − funding owed, in USDC base units.
pub fn equity(p: &Position, m: &Market) -> Result<i128> {
    let size = p.size as i128;
    let entry = p.entry_price as i128;
    let price = m.price as i128;
    let move_ = if p.is_long { price - entry } else { entry - price };
    let pnl = size.checked_mul(move_).ok_or(PerpsError::MathOverflow)? / entry;
    let idx = m.funding_index - p.entry_funding;
    let funding = size.checked_mul(idx).ok_or(PerpsError::MathOverflow)? / FUNDING_SCALE;
    let funding_paid = if p.is_long { funding } else { -funding };
    Ok(p.collateral as i128 + pnl - funding_paid)
}

fn remove_oi(m: &mut Market, p: &Position) {
    if p.is_long { m.oi_long = m.oi_long.saturating_sub(p.size) } else { m.oi_short = m.oi_short.saturating_sub(p.size) }
}

fn transfer_in<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(program.to_account_info(), TransferChecked {
            from: from.to_account_info(),
            mint: mint.to_account_info(),
            to: to.to_account_info(),
            authority: authority.to_account_info(),
        }),
        amount,
        mint.decimals,
    )
}

fn transfer_out<'info>(
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    config: &Account<'info, Config>,
    program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"config", &[config.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(program.to_account_info(), TransferChecked {
            from: vault.to_account_info(),
            mint: mint.to_account_info(),
            to: to.to_account_info(),
            authority: config.to_account_info(),
        }, &[seeds]),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub token: Pubkey,
    pub symbol: [u8; 12],
    pub price: u64,
    pub updated_at: i64,
    pub oi_long: u64,
    pub oi_short: u64,
    pub funding_index: i128,
    pub last_funding_ts: i64,
    pub max_leverage: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub collateral: u64,
    pub size: u64,
    pub entry_price: u64,
    pub entry_funding: i128,
    pub opened_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = admin, seeds = [b"vault"], bump, token::mint = mint, token::authority = config, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token: Pubkey)]
pub struct CreateMarket<'info> {
    #[account(mut, address = config.admin @ PerpsError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Market::INIT_SPACE, seeds = [b"market", token.as_ref()], bump)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(address = config.oracle @ PerpsError::Unauthorized)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.token.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct FundPool<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint)]
    pub funder_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.token.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = owner, space = 8 + Position::INIT_SPACE, seeds = [b"position", market.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.token.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, close = owner, has_one = owner, has_one = market, seeds = [b"position", market.key().as_ref(), owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub liquidator: Signer<'info>,
    /// CHECK: receives the position's rent; must match position.owner
    #[account(mut, address = position.owner)]
    pub owner: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"market", market.token.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, close = owner, has_one = market, seeds = [b"position", market.key().as_ref(), position.owner.as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint)]
    pub liquidator_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------- events & errors

#[event]
pub struct PriceUpdated { pub market: Pubkey, pub price: u64, pub ts: i64 }
#[event]
pub struct PositionOpened { pub owner: Pubkey, pub market: Pubkey, pub is_long: bool, pub collateral: u64, pub size: u64, pub price: u64 }
#[event]
pub struct PositionClosed { pub owner: Pubkey, pub market: Pubkey, pub payout: u64, pub price: u64, pub liquidated: bool }

#[error_code]
pub enum PerpsError {
    #[msg("Not allowed")] Unauthorized,
    #[msg("Bad input")] BadInput,
    #[msg("Clout price is stale; refresh it first")] StalePrice,
    #[msg("Leverage out of range")] BadLeverage,
    #[msg("Amount too small")] TooSmall,
    #[msg("Math overflow")] MathOverflow,
    #[msg("Position is healthy")] NotLiquidatable,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mk(price: u64) -> Market {
        Market { token: Pubkey::default(), symbol: [0; 12], price, updated_at: 0, oi_long: 0, oi_short: 0, funding_index: 0, last_funding_ts: 0, max_leverage: 5, bump: 0 }
    }
    fn pos(is_long: bool, col: u64, lev: u64, entry: u64) -> Position {
        Position { owner: Pubkey::default(), market: Pubkey::default(), is_long, collateral: col, size: col * lev, entry_price: entry, entry_funding: 0, opened_at: 0, bump: 0 }
    }
    #[test]
    fn pnl_long_short() {
        // 10 USDC at 5x on score 50 → 60 (+20%) = +10 USDC
        let p = pos(true, 10_000_000, 5, 50 * PRICE_SCALE);
        assert_eq!(equity(&p, &mk(60 * PRICE_SCALE)).unwrap(), 20_000_000);
        let s = pos(false, 10_000_000, 5, 50 * PRICE_SCALE);
        assert_eq!(equity(&s, &mk(60 * PRICE_SCALE)).unwrap(), 0);
        assert_eq!(equity(&s, &mk(45 * PRICE_SCALE)).unwrap(), 15_000_000);
    }
    #[test]
    fn funding_longs_pay_when_long_heavy() {
        let mut m = mk(50 * PRICE_SCALE);
        m.oi_long = 100_000_000;
        accrue_funding(&mut m, 3600).unwrap();
        // full skew for 1h = 0.10%
        assert_eq!(m.funding_index, FUNDING_SCALE / 1000);
        let p = pos(true, 20_000_000, 5, 50 * PRICE_SCALE); // size 100 USDC
        assert_eq!(equity(&p, &m).unwrap(), 20_000_000 - 100_000);
        let s = pos(false, 20_000_000, 5, 50 * PRICE_SCALE);
        assert_eq!(equity(&s, &m).unwrap(), 20_000_000 + 100_000);
    }
}
