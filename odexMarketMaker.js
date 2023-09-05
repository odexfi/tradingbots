const WebSocket = require('ws');
const { ethers } = require("ethers");
const contracts = require('./../contracts.json');
require("dotenv").config();

const markets = [
    { feed: 'linear', feedRef: 'ODEX-USD', odexMarket: contracts.odexMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.01' },
    { feed: 'coinbaseWS', feedRef: 'BTC-USD', odexMarket: contracts.wbtcMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '1' },
    { feed: 'coinbaseWS', feedRef: 'ETH-USD', odexMarket: contracts.wethMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.1' },
    { feed: 'coinbaseREST', feedRef: 'DOGE-USD', odexMarket: contracts.dogeMarket, odexPrice: 0n, bidAmount: 100000000n, tickRounding: '0.0001' },
    { feed: 'coinbaseREST', feedRef: 'MATIC-USD', odexMarket: contracts.maticMarket, odexPrice: 0n, bidAmount: 100000000n, tickRounding: '0.01' },
    { feed: 'coinbaseREST', feedRef: 'SHIB-USD', odexMarket: contracts.shibMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.000001' },
    { feed: 'coinbaseREST', feedRef: 'LINK-USD', odexMarket: contracts.linkMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.01' },
    { feed: 'coinbaseREST', feedRef: 'UNI-USD', odexMarket: contracts.uniMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.01' },
    { feed: 'coinbaseREST', feedRef: 'LDO-USD', odexMarket: contracts.ldoMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.001' },
    { feed: 'coinbaseREST', feedRef: 'ARB-USD', odexMarket: contracts.arbMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.001' },
    { feed: 'coinbaseREST', feedRef: 'MKR-USD', odexMarket: contracts.mkrMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '1' },
    { feed: 'coinbaseREST', feedRef: 'OP-USD', odexMarket: contracts.opMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.001' },
    { feed: 'coinbaseREST', feedRef: 'AAVE-USD', odexMarket: contracts.aaveMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.01' },
    { feed: 'coinbaseREST', feedRef: 'SNX-USD', odexMarket: contracts.snxMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.01' },
    { feed: 'coinbaseREST', feedRef: 'CRV-USD', odexMarket: contracts.crvMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.001' },
    { feed: 'coinbaseREST', feedRef: 'PAXG-USD', odexMarket: contracts.paxgMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '1' },
    { feed: 'coinbaseREST', feedRef: 'RPL-USD', odexMarket: contracts.rplMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.1' },
    { feed: 'coinbaseREST', feedRef: 'COMP-USD', odexMarket: contracts.compMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.1' },
    { feed: 'krakenREST', feedRef: 'GMXUSD', odexMarket: contracts.gmxMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.1' },
    { feed: 'coinbaseREST', feedRef: 'ENS-USD', odexMarket: contracts.ensMarket, odexPrice: 0n, bidAmount: 1000000000n, tickRounding: '0.1' },
];
const tradeFrequencyLimit = 60 * 1000; // 1 trade every 60 seconds max, + order exec time

const provider = new ethers.providers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');

const loadWallet = new ethers.Wallet(process.env.ODEX_MM_KEY);
const mmWallet = loadWallet.connect(provider);
let inTrade = false;

const odexMarketsAbi = [
    "function midPrice() view returns (uint)",
    "function orderbook() view returns (uint[100] memory, uint[100] memory, address[100] memory, uint[100] memory, uint[100] memory, address[100] memory)",
    "function limitOrderBuy(uint _amount, uint _price) returns (uint)",
    "function limitOrderSell(uint _amount, uint _price) returns (uint)",
    "function cancelAllOrders()",
    "function cancelBid(uint _i)",
    "function cancelAsk(uint _i)",
    "function baseAsset() view returns (address)",
    "function token() view returns (address)",
    "function cancelOrders(uint[] memory _cBids, uint[] memory _cAsks) external",
    "function multiTrade(uint[] memory _bidAmounts, uint[] memory _bidPrices, uint[] memory _askAmounts, uint[] memory _askPrices) external",
    "event Bid(uint amount, uint price, address trader, uint index)",
    "event Ask(uint amount, uint price, address trader, uint index)",
    "event CancelBid(uint amount, uint price, address trader, uint index)",
    "event CancelAsk(uint amount, uint price, address trader, uint index)",
    "event Sell(uint amount, uint price, address trader, address filler, uint index)",
    "event Buy(uint amount, uint price, address trader, address filler, uint index)",
];

const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
];

const checkApprovals = async (market) => {
    console.log(`Checking approvals: ${market.feedRef}`);
    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, mmWallet);
    const baseAssetAddress = await odexMarket.baseAsset();
    const tokenAddress = await odexMarket.token();
    const baseAsset = new ethers.Contract(baseAssetAddress, erc20Abi, mmWallet);
    const baseBalance = await baseAsset.balanceOf(mmWallet.address);
    const baseAllowance = await baseAsset.allowance(mmWallet.address, market.odexMarket);
    const token = new ethers.Contract(tokenAddress, erc20Abi, mmWallet);
    const tokenBalance = await token.balanceOf(mmWallet.address);
    const tokenAllowance = await token.allowance(mmWallet.address, market.odexMarket);

    //console.log('Check Balances', market.feedRef, baseBalance, tokenBalance)
    while(inTrade) await new Promise(r => setTimeout(r, 1000));
    inTrade = true;
    if (BigInt(baseAllowance) < BigInt(baseBalance)) {
        console.log('Approving baseAsset Spend');
        const tx1 = await baseAsset.approve(market.odexMarket, maxUint256);
        await tx1.wait();
    }
    if (BigInt(tokenAllowance) < BigInt(tokenBalance)) {
        console.log('Approving token Spend');
        const tx2 = await token.approve(market.odexMarket, maxUint256);
        await tx2.wait();
    }
    inTrade = false;
}

const setupLinear = async (market) => {
    console.log(`setupLinear: ${market.feedRef}`);
    const startPrice = 10000000n;
    const endPrice = 20000000n;
    const oneMonthInSeconds = 30n * 24n * 60n * 60n;
    const startTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const endTimestamp = startTimestamp + oneMonthInSeconds;
    setInterval(() => {
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const elapsedTimeInSeconds = timestamp - startTimestamp;
        const totalElapsedTimeInSeconds = endTimestamp - startTimestamp;
        const priceChange = endPrice - startPrice;
        const fairValue = startPrice + (priceChange * elapsedTimeInSeconds) / totalElapsedTimeInSeconds;
        priceUpdate(fairValue, market);
    }, 6000);
}

const setupCoinbaseWS = async (market) => {
    console.log(`setupCoinbaseWS: ${market.feedRef}`);
    const socket = new WebSocket('wss://ws-feed.pro.coinbase.com');
    socket.on('open', function open() {
        const subscribeMsg = {
            type: "subscribe",
            product_ids: [market.feedRef],
            channels: ["ticker"]
        };
        socket.send(JSON.stringify(subscribeMsg));
    });
    socket.on('message', function incoming(data) {
        const response = JSON.parse(data);
        if (response.type !== 'ticker') return;
        const usdPrice = ethers.utils.parseUnits(response.price, 6);
        priceUpdate(usdPrice, market);
    });
    socket.on('error', (err) => console.log(`WebSocket Error: ${err}`));
}

const setupCoinbaseREST = async (market) => {
    //console.log(`setupCoinbaseREST: ${market.feedRef}`);
    const endPoint = `https://api.coinbase.com/v2/prices/${market.feedRef}/buy`;
    await fetch(endPoint).then(response => response.json()).then((responseJSON) => {
        if (!responseJSON.data) {
            console.log('odexMarketMaker.js Error 134', responseJSON);
            return;
        }
        const usdTrimmedPrice = parseFloat(responseJSON.data.amount).toFixed(6);
        const usdPrice = ethers.utils.parseUnits(usdTrimmedPrice, 6);
        priceUpdate(usdPrice, market);
    });
    setTimeout(() => {
        setupCoinbaseREST(market);
    }, tradeFrequencyLimit);
}

const setupBinanceREST = async (market) => {
    //console.log(`setupBinanceREST: ${market.feedRef}`);
    // restricted from US servers and IP addresses
    const endPoint = `https://api.binance.com/api/v3/ticker/price?symbol=${market.feedRef}`;
    await fetch(endPoint).then(response => response.json()).then((responseJSON) => {
        if (!responseJSON.price) {
            console.log('odexMarketMaker.js Error 151', responseJSON);
            return;
        }
        const usdTrimmedPrice = parseFloat(responseJSON.price).toFixed(6);
        const usdPrice = ethers.utils.parseUnits(usdTrimmedPrice, 6);
        priceUpdate(usdPrice, market);
    });
    setTimeout(() => {
        setupBinanceREST(market);
    }, tradeFrequencyLimit);
}

const setupKrakenREST = async (market) => {
    const endPoint = `https://api.kraken.com/0/public/Ticker?pair=${market.feedRef}`;
    await fetch(endPoint).then(response => response.json()).then((responseJSON) => {
        if (!responseJSON.result) {
            console.log('odexMarketMaker.js Error 166', responseJSON);
            return;
        }
        const usdTrimmedPrice = parseFloat(responseJSON.result[market.feedRef].a[0]).toFixed(6);
        const usdPrice = ethers.utils.parseUnits(usdTrimmedPrice, 6);
        priceUpdate(usdPrice, market);
    });
    setTimeout(() => {
        setupKrakenREST(market);
    }, tradeFrequencyLimit);
}

const priceUpdate = async (price, market) => {
    //console.log(`priceUpdate: ${market.feedRef} ${price}`);
    const rounding = BigInt(ethers.utils.parseUnits(market.tickRounding, 6));
    const spread = rounding * 3n;
    if (price > market.odexPrice + spread || price < market.odexPrice - spread) {
        if (inTrade) return false;
        inTrade = true;
        market.odexPrice = BigInt(price);
        const randomFactor = BigInt(Number(50 + Math.random() * 50).toFixed()); // 50-100% of amount
        const bidAmount = market.bidAmount * randomFactor / 100n;
        const askAmount = bidAmount * 1000000000000000000n / market.odexPrice;
        const bidPrice = market.odexPrice - spread;
        const askPrice = market.odexPrice + spread;
        console.log(`Trading: ${market.feedRef} $${ethers.utils.formatUnits(price,6)}`);
        await clearOrders(market);
        const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, mmWallet);
        const bidAmounts = [bidAmount, bidAmount*2n, bidAmount*3n, bidAmount*4n, bidAmount*5n, bidAmount*6n];
        const bidPrices = [bidPrice, bidPrice-rounding, bidPrice-(2n*rounding), bidPrice-(3n*rounding), bidPrice-(4n*rounding), bidPrice-(5n*rounding)];
        const askAmounts = [askAmount, askAmount*2n, askAmount*3n, askAmount*4n, askAmount*5n, askAmount*6n];
        const askPrices = [askPrice, askPrice+rounding, askPrice+(2n*rounding), askPrice+(3n*rounding), askPrice+(4n*rounding), askPrice+(5n*rounding)];
        //let gasPrice = await provider.getGasPrice();
        //gasPrice = Math.floor(gasPrice * 1.05);
        const txBid1 = await odexMarket.multiTrade(bidAmounts, bidPrices, askAmounts, askPrices);
        await txBid1.wait();
        console.log('Executed.');
        setTimeout(() => { inTrade = false; }, tradeFrequencyLimit);        
    }
}

const clearOrders = async (market) => {
    const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, mmWallet);
    const ob = await odexMarket.orderbook();
    let cancelBids = [];
    let cancelAsks = [];
    for (let i = 0; i < 100; i++) {
        if (ob[2] == mmWallet.address) {
            if (ob[1] > market.odexPrice - market.spread) cancelBids.push(i);
            if (ob[1] < market.odexPrice - 20000000n) cancelBids.push(i); // $20 out of range
        }
        if (ob[5] == mmWallet.address) {
            if (ob[4] < market.odexPrice + market.spread) cancelAsks.push(i);
            if (ob[1] > market.odexPrice + 20000000n) cancelBids.push(i);
        }
    }
    if (cancelBids.length + cancelAsks.length > 0) {
        console.log(`Clearing ${cancelBids.length} bids & ${cancelAsks.length} asks`)
        const tx = await odexMarket.cancelOrders(cancelBids, cancelAsks);
        await tx.wait();
    }
}

const init = async () => {
    for (const market of markets) {
        await checkApprovals(market);
        if (market.feed == 'coinbaseWS') setupCoinbaseWS(market);
        if (market.feed == 'coinbaseREST') setupCoinbaseREST(market);
        if (market.feed == 'binanceREST') setupBinanceREST(market);
        if (market.feed == 'krakenREST') setupKrakenREST(market);
        if (market.feed == 'linear') setupLinear(market);
    }
}
init();