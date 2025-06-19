import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "orderId", "type": "uint256" },
      { "internalType": "bytes", "name": "proof", "type": "bytes" }
    ],
    "name": "executePendingOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "name": "pendingOrders",
    "outputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "uint256", "name": "assetIndex", "type": "uint256" },
      { "internalType": "uint256", "name": "usdSize", "type": "uint256" },
      { "internalType": "uint256", "name": "leverage", "type": "uint256" },
      { "internalType": "bool", "name": "isLong", "type": "bool" },
      { "internalType": "uint256", "name": "slPrice", "type": "uint256" },
      { "internalType": "uint256", "name": "tpPrice", "type": "uint256" },
      { "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
const app = express();
const port = process.env.PORT || 3000;

app.get("/execute-range", async (req, res) => {
  const start = parseInt(req.query.start);
  const end = parseInt(req.query.end);

  if (isNaN(start) || isNaN(end) || start < end) {
    return res.status(400).json({ error: "Invalid 'start' or 'end' parameters. Must be numbers and start >= end." });
  }

  const results = [];

  for (let i = start; i >= end; i--) {
    try {
      const order = await contract.pendingOrders(i);
      const user = order.user;
      const assetIndex = order.assetIndex.toNumber();

      if (user === "0x0000000000000000000000000000000000000000") {
        console.log(`⚠️ Order #${i} skipped (user = 0x0)`);
        results.push({ orderId: i, status: "skipped", reason: "deleted" });
        continue;
      }

      console.log(`📄 Fetching proof for Order #${i} | index ${assetIndex}`);
      const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: assetIndex })
      });

      const proofData = await proofRes.json();
      const proof = proofData.proof_bytes;

      if (!proof) {
        results.push({ orderId: i, status: "failed", reason: "no proof returned" });
        continue;
      }

      const tx = await contract.executePendingOrder(i, proof, { gasLimit: 800000 });
      await tx.wait();

      console.log(`✅ Order #${i} executed. Tx: ${tx.hash}`);
      results.push({ orderId: i, status: "executed", tx: tx.hash });

    } catch (err) {
      console.error(`❌ Order #${i} failed:`, err.reason || err.message);
      results.push({ orderId: i, status: "error", reason: err.reason || err.message });
    }
  }

  res.json({
    total: results.length,
    executed: results.filter(r => r.status === "executed").length,
    skipped: results.filter(r => r.status === "skipped").length,
    failed: results.filter(r => r.status === "failed" || r.status === "error").length,
    result: results
  });
});

app.listen(port, () => {
  console.log(`🟢 API running at http://localhost:${port}`);
});
