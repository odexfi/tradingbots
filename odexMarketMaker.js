const WebSocket = require('ws');
const { ethers } = require("ethers");
const contracts = require('./../contracts.json');
require("dotenv").config();

const markets = [
    { feed: 'coinbase', feedRef: 'BTC-USD', odexMarket: contracts.wbtcMarket, spread: 500000n, odexPrice: 0n, bidAmount: 10000000n, askAmount: 400000000000000n },
    { feed: 'coinbase', feedRef: 'ETH-USD', odexMarket: contracts.wethMarket, spread: 500000n, odexPrice: 0n, bidAmount: 10000000n, askAmount: 6000000000000000n },
    //{ feed: 'linear', feedRef: 'ODEX-USD', odexMarket: '0xC7e1bbdd1E057Af672A2126c7bE0dC480b93c2cb', spread: 500000n, odexPrice: 0n, bidAmount: 10000000n, askAmount: 600000000000000000n },  
];
const tradeFrequencyLimit = 10 * 1000; // 1 trade every 10 seconds max, + order exec time

const provider = new ethers.providers.JsonRpcProvider('https://scroll-sepolia.chainstacklabs.com');

const loadWallet = new ethers.Wallet(process.env.ODEX_MM_KEY);
const hotWallet = loadWallet.connect(provider);
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
    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, hotWallet);
    const baseAssetAddress = await odexMarket.baseAsset();
    const tokenAddress = await odexMarket.token();
    const baseAsset = new ethers.Contract(baseAssetAddress, erc20Abi, hotWallet);
    const baseBalance = await baseAsset.balanceOf(hotWallet.address);
    const baseAllowance = await baseAsset.allowance(hotWallet.address, market.odexMarket);
    const token = new ethers.Contract(tokenAddress, erc20Abi, hotWallet);
    const tokenBalance = await token.balanceOf(hotWallet.address);
    const tokenAllowance = await token.allowance(hotWallet.address, market.odexMarket);
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

const setupCoinbase = async (market) => {
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

const priceUpdate = async (price, market) => {
    console.log(`priceUpdate: ${market.feedRef} ${price}`);
    if (price > market.odexPrice + market.spread || price < market.odexPrice - market.spread) {
        if (inTrade) return false;
        inTrade = true;
        market.odexPrice = BigInt(price);
        const randomFactor = 0.5 + Math.random() * 0.5; // 50-100% of amount
        const bidAmount = BigInt((Number(market.bidAmount) * randomFactor).toFixed());
        const askAmount = BigInt((Number(market.askAmount) * randomFactor).toFixed());
        const bidPrice = market.odexPrice - market.spread;
        const askPrice = market.odexPrice + market.spread;
        console.log(`Trading: ${market.feedRef} ${ethers.utils.formatUnits(price,6)}`);
        await clearOrders(market);
        const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, hotWallet);
        const bidAmounts = [bidAmount, bidAmount*2n, bidAmount*3n, bidAmount*4n, bidAmount*5n, bidAmount*6n];
        const bidPrices = [bidPrice, bidPrice-1000000n, bidPrice-2000000n, bidPrice-3000000n, bidPrice-4000000n, bidPrice-5000000n];
        const askAmounts = [askAmount, askAmount*2n, askAmount*3n, askAmount*4n, askAmount*5n, askAmount*6n];
        const askPrices = [askPrice, askPrice+1000000n, askPrice+2000000n, askPrice+3000000n, askPrice+4000000n, askPrice+5000000n];
        const txBid1 = await odexMarket.multiTrade(bidAmounts, bidPrices, askAmounts, askPrices);
        await txBid1.wait();
        console.log('Executed.');
        setTimeout(() => { inTrade = false; }, tradeFrequencyLimit);        
    }
}

const clearOrders = async (market) => {
    const odexMarket = new ethers.Contract(market.odexMarket, odexMarketsAbi, hotWallet);
    const ob = await odexMarket.orderbook();
    let cancelBids = [];
    let cancelAsks = [];
    for (let i = 0; i < 100; i++) {
        if (ob[2] == hotWallet.address) {
            if (ob[1] > market.odexPrice - market.spread) cancelBids.push(i);
            if (ob[1] < market.odexPrice - 20000000n) cancelBids.push(i); // $20 out of range
        }
        if (ob[5] == hotWallet.address) {
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
        if (market.feed == 'coinbase') setupCoinbase(market);
        if (market.feed == 'linear') setupLinear(market);
    }
}
init();