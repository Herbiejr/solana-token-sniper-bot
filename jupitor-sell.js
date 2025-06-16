import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import fetch from 'cross-fetch';
import { Wallet } from '@project-serum/anchor';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const RPC_URL            = process.env.RPC_URL;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

if (!RPC_URL || !WALLET_PRIVATE_KEY) {
  console.error('❌ Set RPC_URL and WALLET_PRIVATE_KEY');
  process.exit(1);
}

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = new Wallet(
  Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY))
);

async function notifyTelegram(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' },
      { timeout: 10000 }
    );
  } catch {}
}

const INPUT_MINT  = NATIVE_MINT.toBase58();
const OUTPUT_MINT = '5C8LMqZ9dbQ3RWoe5pFk5fJPhgiBQtBYdMnzekfJpump';
const DECIMALS    = 9;
const SLIPPAGE_BPS         = 200;
const TARGET_SELL_USD      = 0.0017;
const STOP_LOSS_USD        = 0;
const CHECK_INTERVAL_MS    = 20000;
const TELEGRAM_INTERVAL_MS = 120000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchTokenPrice(mint) {
  try {
    const r = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const p = r.data.pairs?.[0]?.priceUsd;
    return p ? parseFloat(p) : null;
  } catch {
    return null;
  }
}

async function getBalanceLamports() {
  const resp = await connection.getTokenAccountsByOwner(
    wallet.publicKey,
    { mint: new PublicKey(OUTPUT_MINT) }
  );
  if (!resp.value.length) return 0;
  const acct = resp.value[0].pubkey;
  const bal  = await connection.getTokenAccountBalance(acct);
  return parseInt(bal.value.amount, 10);
}

async function fetchQuote(amount) {
  const url =
    `https://quote-api.jup.ag/v6/quote?` +
    `inputMint=${OUTPUT_MINT}` +
    `&outputMint=${INPUT_MINT}` +
    `&amount=${amount}` +
    `&slippageBps=${SLIPPAGE_BPS}` +
    `&onlyDirectRoutes=true`;
  for (let i = 1; i <= 3; i++) {
    try {
      const rsp = await fetch(url, { timeout: 10000 });
      if (!rsp.ok) throw new Error(rsp.status);
      return await rsp.json();
    } catch (e) {
      if (i === 3) throw e;
      await sleep(2000);
    }
  }
}

async function fetchSwapTx(quote) {
  const rsp = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true
    })
  });
  if (!rsp.ok) throw new Error(rsp.status);
  return await rsp.json();
}

async function sendTx(b64, uiAmount) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
  tx.sign([wallet.payer]);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`Sold ${uiAmount} Token — Tx: ${sig}`);
  await notifyTelegram(`💸 Sold ${uiAmount} Token — Tx: ${sig}`);
}

async function monitorSell() {
  console.log(`Watching Token: sell≥$${TARGET_SELL_USD} or ≤$${STOP_LOSS_USD}`);
  setInterval(async () => {
    const price = await fetchTokenPrice(OUTPUT_MINT);
    if (price != null) await notifyTelegram(`📈 Token price: $${price.toFixed(6)}`);
  }, TELEGRAM_INTERVAL_MS);

  while (true) {
    const price    = await fetchTokenPrice(OUTPUT_MINT);
    if (price == null) { await sleep(CHECK_INTERVAL_MS); continue; }
    console.log(`Price: $${price.toFixed(6)} | Sell@${TARGET_SELL_USD} | SL@${STOP_LOSS_USD}`);

    if (price >= TARGET_SELL_USD || price <= STOP_LOSS_USD) {
      const lamports = await getBalanceLamports();
      if (!lamports) { console.error('No Token balance'); return; }
      const uiAmount = lamports / 10**DECIMALS;

      await notifyTelegram(`🔔 Selling ${uiAmount} Token @ $${price.toFixed(6)}`);
      const quote    = await fetchQuote(lamports);
      const swapData = await fetchSwapTx(quote);
      await sendTx(swapData.swapTransaction, uiAmount);
      break;
    }
    await sleep(CHECK_INTERVAL_MS);
  }
}

(async () => {
  console.log('🚀 sell-only bot started');
  await notifyTelegram('🚀 sell-only bot started');
  try {
    await monitorSell();
  } catch (e) {
    console.error(e);
    await notifyTelegram(`❌ ${e.message}`);
  }
  process.exit(0);
})();
