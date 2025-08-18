# Solana Token Sniper Bot

An automated Solana token trading bot that detects new tokens, validates them through multiple criteria, and executes buy/sell trades via Jupiter aggregator. Features real-time monitoring, risk management, and Telegram notifications.

## Important Disclaimers

- **This bot involves significant financial risk. Only use funds you can afford to lose.**
- **Automated trading can result in substantial losses. Past performance doesn't guarantee future results.**
- **Always test with small amounts first and understand the risks involved.**
- **Keep your private keys secure and never share them.**

## Features

- **Automated Token Detection**: Listens for new tokens via webhook integration
- **Multi-Layer Validation**: 
  - Token age verification (max 2 minutes old)
  - Liquidity validation (min $5M USD)
  - Market cap and FDV ratio checks
  - Risk score assessment via RugCheck API
  - Volume and transaction validation
- **Jupiter Integration**: Uses Jupiter aggregator for optimal swap routes
- **Risk Management**: Configurable stop-loss and profit targets
- **Telegram Notifications**: Real-time trade alerts and price updates
- **Dual Operation Modes**: 
  - Full sniper bot with buy/sell automation
  - Sell-only mode for existing positions

## Prerequisites

- Node.js (v16 or higher)
- Solana wallet with sufficient SOL balance
- High-quality RPC endpoint (recommended: QuickNode, Helius, or similar)
- API access to:
  - DexScreener API
  - RugCheck API
  - Telegram Bot API (optional)

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd solana-token-sniper-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp env.example .env
   ```

4. **Edit the `.env` file** with your configuration (see Configuration section below)

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Required: Your wallet's private key in base58 format
WALLET_PRIVATE_KEY=your_wallet_private_key_here

# Required: High-quality RPC endpoint
RPC_URL=https://your-rpc-endpoint.com

# Jupiter API base URL (usually default is fine)
METIS_JUPITER_BASE_URL=https://quote-api.jup.ag

# Optional: Telegram notifications
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Optional: gRPC settings (not currently used)
GRPC_URL=
GRPC_TOKEN=
```

### Trading Parameters

The bot includes several configurable parameters in the source files:

#### Main Sniper Bot (`jupitor-helius-sniper.js`):
- `SLIPPAGE_BPS`: 100 (1% slippage)
- `AMOUNT_TO_TRADE`: 0.1 SOL per trade
- `PRICE_CHECK_INTERVAL`: 5000ms (5 seconds)
- `MAX_HOLD_TIME`: 300000ms (5 minutes)

#### Validation Thresholds:
- `maxAgeInMinutes`: 2 minutes
- `minLiquidityUsd`: $5,000,000
- `minMarketCap`: $100,000
- `minMarketCapToFdvRatio`: 0.9
- `maxRiskScore`: 1
- `minFirst5MinVolume`: $500
- `minFirst5MinTxns`: 10 transactions

#### Sell-Only Bot (`jupitor-sell.js`):
- `TARGET_SELL_USD`: $0.0017 (sell target price)
- `STOP_LOSS_USD`: $0 (stop loss price)
- `CHECK_INTERVAL_MS`: 20000ms (20 seconds)
- `SLIPPAGE_BPS`: 200 (2% slippage)

## Usage

### Running the Main Sniper Bot

The main bot listens for webhook notifications of new tokens:

```bash
node jupitor-helius-sniper.js
```

The bot will:
1. Start an Express server on port 3000 (or PORT env variable)
2. Listen for webhook POST requests at `/webhook`
3. Validate incoming tokens against multiple criteria
4. Execute buy orders for validated tokens
5. Monitor positions and execute sell orders based on conditions

### Running the Sell-Only Bot

For monitoring and selling existing positions:

```bash
node jupitor-sell.js
```

**Note**: Configure the `OUTPUT_MINT` variable in the file to match your token's mint address.

### Webhook Setup

The sniper bot expects webhook data in this format:
```json
[
  {
    "tokenTransfers": [
      {
        "mint": "token_mint_address_here"
      }
    ]
  }
]
```

Set up your webhook provider to send POST requests to:
```
http://your-server:3000/webhook
```

## Customization

### Modifying Trading Parameters

Edit the configuration constants at the top of each file:

- **Amount per trade**: Change `AMOUNT_TO_TRADE` in `jupitor-helius-sniper.js`
- **Profit/loss targets**: Modify the exit conditions in the price monitoring loop
- **Validation criteria**: Adjust `VALIDATION_CONFIG` object parameters
- **Timing intervals**: Update `PRICE_CHECK_INTERVAL` and `MAX_HOLD_TIME`

### Adding New Validation Rules

The `validateToken` function in `jupitor-helius-sniper.js` can be extended with additional checks:

```javascript
// Add custom validation logic
if (customCondition) {
    console.log('Custom validation failed');
    return false;
}
```

## API Dependencies

### Jupiter Aggregator
- **Quote API**: `https://quote-api.jup.ag/v6/quote`
- **Swap API**: `https://quote-api.jup.ag/v6/swap`
- Used for fetching optimal swap routes and executing trades

### DexScreener API
- **Endpoint**: `https://api.dexscreener.com/latest/dex/tokens/{token_address}`
- Used for token validation and price monitoring
- No API key required

### RugCheck API
- **Endpoint**: `https://api.rugcheck.xyz/v1/tokens/{token_address}/report/summary`
- Used for risk score assessment
- No API key required

### Telegram Bot API (Optional)
- **Setup**: Create a bot via @BotFather on Telegram
- **Get Chat ID**: Send a message to your bot and call the getUpdates API
- Used for trade notifications and price alerts

## Troubleshooting

### Common Issues

#### "Insufficient balance" errors
- Ensure your wallet has enough SOL for trades plus transaction fees
- Check that `AMOUNT_TO_TRADE` doesn't exceed your balance

#### Quote/swap failures
- Verify your RPC endpoint is working and not rate-limited
- Check Jupiter API status
- Reduce trade size if liquidity is insufficient

#### Webhook not receiving data
- Verify your server is accessible from the internet
- Check firewall settings and port forwarding
- Ensure webhook URL is correctly configured in your provider

#### Transaction failures
- Increase slippage tolerance (`SLIPPAGE_BPS`)
- Check network congestion and adjust priority fees
- Verify token is actually tradeable on Jupiter

### Debug Tips

1. **Enable detailed logging**: Add console.log statements to track execution flow
2. **Test with small amounts**: Start with minimal SOL amounts
3. **Monitor RPC calls**: Check for rate limiting or connection issues
4. **Verify token addresses**: Ensure mint addresses are correct and valid

## Security Best Practices

1. **Private Key Security**:
   - Never commit private keys to version control
   - Use hardware wallets when possible
   - Store private keys in secure, encrypted storage

2. **RPC Security**:
   - Use reputable RPC providers
   - Keep RPC URLs private to avoid rate limiting

3. **Environment Security**:
   - Run the bot in a secure environment
   - Keep dependencies updated
   - Monitor for unusual activity

4. **Financial Security**:
   - Start with small test amounts
   - Set reasonable risk limits
   - Never invest more than you can afford to lose

## Monitoring and Logs

The bot provides extensive logging for monitoring:

- Token detection and validation results
- Trade execution confirmations with transaction links
- Price monitoring updates
- Error messages and retry attempts
- Telegram notifications for key events

Monitor the console output and set up log rotation for production use.

## Legal Considerations

- Ensure compliance with local financial regulations
- Understand tax implications of automated trading
- This software is provided as-is without warranties
- Users are responsible for their own trading decisions and results

## Contributing

This is a specialized trading bot. Please thoroughly test any modifications before deploying with real funds.

## License

Use at your own risk. No warranties provided.

---

**Remember**: Cryptocurrency trading involves substantial risk. This bot is a tool that requires careful configuration and monitoring. Always test thoroughly and understand the risks before deploying with significant funds.
