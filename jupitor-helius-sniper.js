import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import fetch from 'cross-fetch';
import { Wallet } from '@project-serum/anchor';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import axios from 'axios';
import express from 'express';

// Load environment variables from .env file
dotenv.config();

// Global variables to track tokens
let latestTokenAddress = null;
const processingTokens = new Set();

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize connection and wallet
const connection = new Connection('https://flashy-black-asphalt.solana-mainnet.quiknode.pro/39c8195d5f64df2e91d4f64f9384828cc36d825b');
const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY)));

// === CONFIG ===
const SLIPPAGE_BPS = 100;            // 1% slippage for faster execution
const AMOUNT_TO_TRADE = 0.1;         // Amount of SOL to trade
const PRICE_CHECK_INTERVAL = 5000;    // Check price every 5 seconds
const MAX_HOLD_TIME = 300000;        // Maximum hold time in ms (5 minutes)

// Validation thresholds
const VALIDATION_CONFIG = {
    maxAgeInMinutes: 2,
    minLiquidityUsd: 5000000,
    minMarketCap: 100000,
    minMarketCapToFdvRatio: 0.9,
    maxRiskScore: 1,
    minFirst5MinVolume: 500,
    minFirst5MinTxns: 10
};

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const countdown = async (seconds) => {
    for (let i = seconds; i > 0; i--) {
        console.log(`Retrying in ${i} seconds...`);
        await sleep(1000);
    }
};

// Function to check wallet balance
async function checkWalletBalance() {
    try {
        const balance = await connection.getBalance(wallet.publicKey);
        const solBalance = balance / 1e9;
        console.log(`Wallet SOL balance: ${solBalance}`);
        
        if (solBalance < AMOUNT_TO_TRADE) {
            console.error(`Insufficient balance. Need ${AMOUNT_TO_TRADE} SOL but only have ${solBalance} SOL`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error checking wallet balance:', error);
        return false;
    }
}

// Token validation function
const validateToken = async (token) => {
    const { tokenAddress } = token;
    const config = VALIDATION_CONFIG;
    const retryInterval = 60000; // Retry every 1 minute (60,000 ms)
    const maxRetries = 5; // Maximum retries before giving up

    try {
        let retries = 0;
        let isValid = false;

        // Retry mechanism for checking trading pairs
        while (retries < maxRetries && !isValid) {
            const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
            console.log('DexScreener Response:', response.data);

            // If pairs are found, we proceed with validation
            const pairs = response.data?.pairs || [];

            if (pairs && pairs.length > 0) {
                isValid = true;
                console.log('Token has valid trading pairs.');
            } else {
                console.log(`No trading pairs found for token ${tokenAddress}. Retrying in ${retryInterval / 1000} seconds...`);
                retries++;
                await new Promise(resolve => setTimeout(resolve, retryInterval)); // Wait before retrying
            }
        }

        // If no valid pairs after retries, return false
        if (!isValid) {
            console.error(`Token ${tokenAddress} failed validation after ${maxRetries} retries.`);
            return false;
        }

        // Token age validation
        const pair = pairs[0]; // Using the first available pair for further checks
        const pairCreatedAt = pair.pairCreatedAt;

        if (!pairCreatedAt) {
            console.warn(`No pairCreatedAt found for token ${tokenAddress}. Skipping.`);
            return false;
        }

        const currentTime = Date.now();
        const ageInMinutes = (currentTime - pairCreatedAt) / (1000 * 60);
        console.log(`Token ${tokenAddress} age: ${ageInMinutes.toFixed(2)} minutes`);

        if (ageInMinutes > config.maxAgeInMinutes || ageInMinutes < 0) {
            console.log(`Token age validation failed: ${ageInMinutes} minutes`);
            return false;
        }

        // Validate liquidity
        const liquidity = pair.liquidity?.usd || 0;
        console.log(`Liquidity: $${liquidity}`);
        if (liquidity < config.minLiquidityUsd) {
            console.log(`Insufficient liquidity: $${liquidity}`);
            return false;
        }

        // Validate market cap and FDV (Fully Diluted Valuation)
        const marketCap = pair.marketCap || 0;
        const fdv = pair.fdv || 0;
        console.log(`Market Cap: ${marketCap}, FDV: ${fdv}`);
        if (marketCap < config.minMarketCap || marketCap / fdv < config.minMarketCapToFdvRatio) {
            console.log(`Market cap validation failed: MC=${marketCap}, FDV=${fdv}`);
            return false;
        }

        // Validate transaction and volume for the first 5 minutes
        const txns5Min = pair.txns?.m5 || 0;
        const volume5Min = pair.volume?.m5 || 0;
        console.log(`Transactions (5min): ${txns5Min}, Volume (5min): ${volume5Min}`);
        if (txns5Min < config.minFirst5MinTxns || volume5Min < config.minFirst5MinVolume) {
            console.log(`Volume/transaction validation failed: Txns=${txns5Min}, Volume=${volume5Min}`);
            return false;
        }

        // Validate risk score with RugCheck
        try {
            const rugCheckResponse = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report/summary`, {
                headers: { Accept: 'application/json' }
            });
            const riskScore = rugCheckResponse.data.score;
            console.log(`Risk Score: ${riskScore}`);
            if (riskScore > config.maxRiskScore) {
                console.log(`Risk score too high: ${riskScore}`);
                return false;
            }
        } catch (rugCheckError) {
            console.error(`RugCheck validation failed:`, rugCheckError.message);
            return false;
        }

        // All validations passed
        return true;
    } catch (error) {
        // Log the full error object to understand the issue better
        console.error(`Validation error for token ${tokenAddress}:`, error);
        return false;
    }
};


// Jupiter swap functions
async function fetchQuoteWithRetry(tokenMint, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const amountInLamports = Math.floor(AMOUNT_TO_TRADE * 1e9);
            const response = await fetch(
                `https://quote-api.jup.ag/v6/quote?inputMint=${NATIVE_MINT.toBase58()}\
&outputMint=${tokenMint}\
&amount=${amountInLamports}\
&slippageBps=${SLIPPAGE_BPS}`,
                { timeout: 10000 }
            );

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            console.log('Quote fetched successfully');
            return data;
        } catch (error) {
            console.error(`Quote attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            await sleep(2000);
        }
    }
}

async function executeSwap(quoteResponse) {
    try {
        const { swapTransaction } = await (
            await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse,
                    userPublicKey: wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true
                })
            })
        ).json();

        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        transaction.sign([wallet.payer]);
        const latestBlockHash = await connection.getLatestBlockhash();
        const txid = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 2
        });
        
        await connection.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: txid
        });

        console.log(`Transaction successful: https://solscan.io/tx/${txid}`);
        return true;
    } catch (error) {
        console.error('Swap execution error:', error);
        return false;
    }
}

// Function to fetch token price from DexScreener
async function fetchTokenPrice(tokenMint) {
    try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
        const pairs = response.data?.pairs || [];
        
        if (!pairs || pairs.length === 0) {
            console.error(`No pairs found for token ${tokenMint}`);
            return null;
        }
        
        // Use the first pair's price
        const price = pairs[0]?.priceUsd;
        if (!price) {
            console.error(`No price found for token ${tokenMint}`);
            return null;
        }
        
        return parseFloat(price);
    } catch (error) {
        console.error(`Error fetching price for ${tokenMint}:`, error.message);
        return null;
    }
}

// Main trading function
async function processNewToken(tokenMint) {
    try {
        // Validate the token
        const isValid = await validateToken({ tokenAddress: tokenMint });
        if (!isValid) {
            console.log(`Token ${tokenMint} failed validation`);
            return;
        }

        console.log(`Token ${tokenMint} passed validation, executing buy...`);

        // Execute buy with Jupiter
        const buyQuote = await fetchQuoteWithRetry(tokenMint);
        if (!buyQuote) {
            console.error('Failed to get buy quote');
            return;
        }

        const buySuccess = await executeSwap(buyQuote);
        if (!buySuccess) {
            console.error('Buy transaction failed');
            return;
        }

        console.log('Buy successful! Starting price monitoring...');
        
        // Monitor price and manage position
        const startTime = Date.now();
        const entryPrice = await fetchTokenPrice(tokenMint);
        let highestPrice = entryPrice;

        while (true) {
            const currentPrice = await fetchTokenPrice(tokenMint);
            if (!currentPrice) {
                await sleep(PRICE_CHECK_INTERVAL);
                continue;
            }

            highestPrice = Math.max(highestPrice, currentPrice);
            const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
            const drawdown = ((currentPrice - highestPrice) / highestPrice) * 100;

            console.log(`
Current Status:
Price: $${currentPrice}
Change: ${priceChangePercent.toFixed(2)}%
Drawdown: ${drawdown.toFixed(2)}%
            `);

            // Exit conditions
            const timeHeld = Date.now() - startTime;
            if (timeHeld >= MAX_HOLD_TIME || priceChangePercent >= 20 || priceChangePercent <= -10) {
                console.log('Exit condition met, selling position...');
                
                // Execute sell with Jupiter
                const sellQuote = await fetchQuoteWithRetry(tokenMint);
                if (sellQuote) {
                    const sellSuccess = await executeSwap(sellQuote);
                    if (sellSuccess) {
                        console.log(`Trade completed! P/L: ${priceChangePercent.toFixed(2)}%`);
                        return;
                    }
                }
            }

            await sleep(PRICE_CHECK_INTERVAL);
        }
    } catch (error) {
        console.error('Error processing token:', error);
    } finally {
        processingTokens.delete(tokenMint);
    }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        res.status(200).send('Webhook received');

        const payload = req.body;
        const firstMint = payload?.[0]?.tokenTransfers?.[0]?.mint;

        if (firstMint && !processingTokens.has(firstMint)) {
            console.log(`Received new token: ${firstMint}`);
            latestTokenAddress = firstMint;
            processingTokens.add(firstMint);

            // Process token in background
            processNewToken(firstMint).catch(error => {
                console.error('Error in token processing:', error);
                processingTokens.delete(firstMint);
            });
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
