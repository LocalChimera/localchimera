/**
 * PayoutRouter
 *
 * Tracks every app that integrates Chimera, their developers, fee structures,
 * users, wallet addresses, and completed orders.
 *
 * Monthly cycle:
 *   1. Record all orders throughout the month
 *   2. At month end, compute payout manifest
 *   3. Distribute: app developer fee + machine owner remainder
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PayoutStore } from './PayoutStore.js';
import { Logger } from '../core/Logger.js';

const logger = new Logger('PayoutRouter');

export class PayoutRouter {
  constructor(config = {}) {
    this.config = config;
    this.store = new PayoutStore(config.dataDir);
  }

  // ─── App Registration ───

  async registerApp({ appId, name, developerEVM, feePercent }) {
    if (!appId || !developerEVM) {
      return { success: false, error: 'appId and developerEVM required' };
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(developerEVM)) {
      return { success: false, error: 'developerEVM must be a valid EVM address' };
    }
    const fp = typeof feePercent === 'number' ? feePercent : 0.30;
    if (fp < 0 || fp > 1) {
      return { success: false, error: 'feePercent must be between 0 and 1' };
    }

    const apps = await this.store.getApps();
    apps[appId] = {
      appId,
      name: name || appId,
      developerEVM: developerEVM.toLowerCase(),
      feePercent: fp,
      registeredAt: Date.now(),
      userCount: 0,
      totalRevenue: 0
    };
    await this.store.saveApps();
    logger.info(`[payout] App registered: ${appId} (${name}) — dev: ${developerEVM}, fee: ${(fp * 100).toFixed(1)}%`);
    return { success: true, app: apps[appId] };
  }

  async getApps() {
    const apps = await this.store.getApps();
    return { success: true, apps: Object.values(apps) };
  }

  async getApp(appId) {
    const apps = await this.store.getApps();
    const app = apps[appId];
    if (!app) return { success: false, error: 'App not found' };
    return { success: true, app };
  }

  // ─── User Registration ───

  async registerUser({ userId, machineOwnerEVM, appId, deviceFingerprint = null, deviceTrustScore = 0 }) {
    if (!userId || !machineOwnerEVM || !appId) {
      return { success: false, error: 'userId, machineOwnerEVM, and appId required' };
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(machineOwnerEVM)) {
      return { success: false, error: 'machineOwnerEVM must be a valid EVM address' };
    }

    const apps = await this.store.getApps();
    if (!apps[appId]) {
      return { success: false, error: `App ${appId} not registered` };
    }

    const users = await this.store.getUsers();
    const existing = users[userId] || {};
    users[userId] = {
      userId,
      machineOwnerEVM: machineOwnerEVM.toLowerCase(),
      appId,
      registeredAt: Date.now(),
      totalOrders: 0,
      totalEarned: 0,
      deviceFingerprint: deviceFingerprint || existing.deviceFingerprint || null,
      deviceTrustScore: deviceTrustScore ?? existing.deviceTrustScore ?? 0,
    };
    if (!existing.registeredAt) {
      apps[appId].userCount = (apps[appId].userCount || 0) + 1;
    }
    await this.store.saveUsers();
    await this.store.saveApps();
    logger.info(`[payout] User registered: ${userId} → app: ${appId}, wallet: ${machineOwnerEVM}, trust: ${(deviceTrustScore * 100).toFixed(0)}%`);
    return { success: true, user: users[userId] };
  }

  async getUsers(appId) {
    const users = await this.store.getUsers();
    const list = Object.values(users);
    if (appId) return { success: true, users: list.filter(u => u.appId === appId) };
    return { success: true, users: list };
  }

  // ─── Order Recording ───

  async recordOrder({ orderId, userId, appId, miner, amount, metadata = {} }) {
    if (!orderId || !userId || !appId || !miner || typeof amount !== 'number') {
      return { success: false, error: 'orderId, userId, appId, miner, and amount required' };
    }
    if (amount <= 0) {
      return { success: false, error: 'amount must be positive' };
    }

    const apps = await this.store.getApps();
    const users = await this.store.getUsers();
    if (!apps[appId]) return { success: false, error: 'App not found' };
    if (!users[userId]) return { success: false, error: 'User not found' };

    const orders = await this.store.getOrders();
    const now = Date.now();
    orders[orderId] = {
      orderId,
      userId,
      appId,
      miner,
      amount,
      metadata,
      timestamp: now,
      year: new Date(now).getUTCFullYear(),
      month: new Date(now).getUTCMonth() + 1
    };

    // Update user + app aggregates
    users[userId].totalOrders = (users[userId].totalOrders || 0) + 1;
    users[userId].totalEarned = (users[userId].totalEarned || 0) + amount;
    apps[appId].totalRevenue = (apps[appId].totalRevenue || 0) + amount;

    await this.store.saveOrders();
    await this.store.saveUsers();
    await this.store.saveApps();
    logger.info(`[payout] Order recorded: ${orderId} — ${miner} — amount: ${amount.toFixed(6)}`);
    return { success: true, order: orders[orderId] };
  }

  async getOrders({ userId, appId, year, month } = {}) {
    const orders = await this.store.getOrders();
    let list = Object.values(orders);
    if (userId) list = list.filter(o => o.userId === userId);
    if (appId) list = list.filter(o => o.appId === appId);
    if (year) list = list.filter(o => o.year === year);
    if (month) list = list.filter(o => o.month === month);
    return { success: true, orders: list, total: list.reduce((s, o) => s + o.amount, 0) };
  }

  // ─── Monthly Payout Calculation ───

  async calculateMonthlyPayout(year, month) {
    const { orders } = await this.getOrders({ year, month });
    const apps = await this.store.getApps();
    const users = await this.store.getUsers();

    // Group orders by (appId, userId)
    const byUserApp = {};
    for (const o of orders) {
      const key = `${o.appId}:${o.userId}`;
      byUserApp[key] = byUserApp[key] || { appId: o.appId, userId: o.userId, amount: 0, orders: 0 };
      byUserApp[key].amount += o.amount;
      byUserApp[key].orders += 1;
    }

    const distributions = [];
    const appTotals = {};

    for (const key in byUserApp) {
      const entry = byUserApp[key];
      const app = apps[entry.appId];
      const user = users[entry.userId];
      if (!app || !user) continue;

      const feeRate = app.feePercent || 0.30;
      const devAmount = entry.amount * feeRate;
      const userAmount = entry.amount * (1 - feeRate);

      distributions.push({
        userId: entry.userId,
        appId: entry.appId,
        machineOwnerEVM: user.machineOwnerEVM,
        developerEVM: app.developerEVM,
        totalAmount: entry.amount,
        feeRate,
        devAmount,
        userAmount,
        orderCount: entry.orders
      });

      appTotals[entry.appId] = appTotals[entry.appId] || { appId: entry.appId, devTotal: 0, userTotal: 0, orderCount: 0 };
      appTotals[entry.appId].devTotal += devAmount;
      appTotals[entry.appId].userTotal += userAmount;
      appTotals[entry.appId].orderCount += entry.orders;
    }

    const manifest = {
      year,
      month,
      generatedAt: Date.now(),
      totalOrders: orders.length,
      totalRevenue: orders.reduce((s, o) => s + o.amount, 0),
      distributions,
      appSummaries: Object.values(appTotals)
    };

    const payouts = await this.store.getPayouts();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    payouts[key] = manifest;
    await this.store.savePayouts();

    logger.info(`[payout] Manifest ${key}: ${manifest.totalOrders} orders, ${manifest.totalRevenue.toFixed(6)} total`);
    return { success: true, manifest };
  }

  async getPayoutManifest(year, month) {
    const payouts = await this.store.getPayouts();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const manifest = payouts[key];
    if (!manifest) return { success: false, error: 'Manifest not found' };
    return { success: true, manifest };
  }

  // ─── Distribution ───

  async markDistributed(year, month, txHash) {
    const distributions = await this.store.getDistributions();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    distributions[key] = {
      year,
      month,
      generatedAt: Date.now(),
      distributedAt: null,
      txHash: txHash || null,
      status: 'calculated', // calculated | pending | denied | executing | confirmed
      denialWindowHours: 168, // 7 days
      denials: []
    };
    await this.store.saveDistributions();
    logger.info(`[payout] Distribution marked for ${key}: ${txHash || 'pending'}`);
    return { success: true, distribution: distributions[key] };
  }

  async getDistributionStatus(year, month) {
    const distributions = await this.store.getDistributions();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const d = distributions[key];
    if (!d) return { success: false, error: 'No distribution record' };

    // Check if denial window expired and no denials -> auto-execute
    const shouldExecute = this._shouldAutoExecute(d);
    if (shouldExecute && d.status === 'calculated') {
      logger.info(`[payout] Auto-executing ${key} — no denial within ${d.denialWindowHours}h window`);
      const exec = await this.executeDistribution(year, month);
      d.status = exec.success ? 'executing' : 'failed';
      await this.store.saveDistributions();
      return { success: true, distribution: d, autoExecuted: true };
    }

    return { success: true, distribution: d };
  }

  _shouldAutoExecute(d) {
    if (d.status !== 'calculated') return false;
    if ((d.denials || []).length > 0) return false;
    const elapsed = (Date.now() - d.generatedAt) / (1000 * 60 * 60); // hours
    return elapsed >= (d.denialWindowHours || 168);
  }

  async denyDistribution(year, month, { memberId, reason } = {}) {
    const distributions = await this.store.getDistributions();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const d = distributions[key];
    if (!d) return { success: false, error: 'No distribution record' };
    if (d.status !== 'calculated') return { success: false, error: `Cannot deny — status is ${d.status}` };

    const elapsed = (Date.now() - d.generatedAt) / (1000 * 60 * 60);
    if (elapsed >= (d.denialWindowHours || 168)) {
      return { success: false, error: 'Denial window has expired' };
    }

    d.denials = d.denials || [];
    d.denials.push({
      memberId: memberId || 'unknown',
      reason: reason || '',
      timestamp: Date.now()
    });
    d.status = 'denied';
    await this.store.saveDistributions();
    logger.warn(`[payout] Distribution ${key} DENIED by ${memberId || 'unknown'}: ${reason || 'no reason'}`);
    return { success: true, distribution: d };
  }

  async executeDistribution(year, month) {
    const distributions = await this.store.getDistributions();
    const payouts = await this.store.getPayouts();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const d = distributions[key];
    const manifest = payouts[key];
    if (!d) return { success: false, error: 'No distribution record' };
    if (!manifest) return { success: false, error: 'No manifest found' };
    if (d.status === 'executing' || d.status === 'confirmed') {
      return { success: false, error: `Already ${d.status}` };
    }

    // Build distribution plan
    const byWallet = {};
    for (const dist of manifest.distributions || []) {
      byWallet[dist.developerEVM] = (byWallet[dist.developerEVM] || 0) + dist.devAmount;
      byWallet[dist.machineOwnerEVM] = (byWallet[dist.machineOwnerEVM] || 0) + dist.userAmount;
    }
    const plan = Object.entries(byWallet)
      .map(([address, amount]) => ({ address, amount: parseFloat(amount.toFixed(6)) }))
      .filter(x => x.amount > 0);

    d.status = 'executing';
    d.executionStartedAt = Date.now();
    d.recipients = plan.length;
    await this.store.saveDistributions();
    logger.info(`[payout] Execution started for ${key}: ${plan.length} recipients`);

    const dir = this.store.dataDir;
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `execution-${year}-${String(month).padStart(2, '0')}.json`);
    await fs.writeFile(file, JSON.stringify(
      { year, month, executedAt: d.executionStartedAt, status: 'executing', totalRecipients: plan.length, recipients: plan },
      null, 2), 'utf-8');
    logger.info(`[payout] Audit file: ${file}`);

    const signingKey = process.env.PAYOUT_SIGNING_KEY?.trim();
    const rpcUrl = this.config.rpcUrl || 'https://arb1.arbitrum.io/rpc';

    if (!signingKey) {
      d.status = 'failed';
      d.error = 'PAYOUT_SIGNING_KEY env var not set';
      await this.store.saveDistributions();
      logger.error('[payout] PAYOUT_SIGNING_KEY not set — distribution aborted');
      return { success: false, error: d.error, plan };
    }

    const account = privateKeyToAccount(signingKey);
    const chain = { id: this.config.chainId || 42161, name: 'arbitrum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    logger.info(`[payout] Sending from ${account.address} via ${rpcUrl}`);

    const txHashes = [];
    const failures = [];
    for (const { address, amount } of plan) {
      try {
        const hash = await walletClient.sendTransaction({
          to: address,
          value: parseEther(amount.toString()),
        });
        logger.info(`[payout] Sent ${amount} ETH → ${address} (${hash})`);
        txHashes.push({ address, amount, txHash: hash });
      } catch (err) {
        logger.error(`[payout] Transfer to ${address} failed: ${err.message}`);
        failures.push({ address, amount, error: err.message });
      }
    }

    d.status = failures.length === 0 ? 'confirmed' : (txHashes.length > 0 ? 'partial' : 'failed');
    d.distributedAt = Date.now();
    d.txHashes = txHashes;
    if (failures.length) d.failures = failures;
    await this.store.saveDistributions();

    await fs.writeFile(file, JSON.stringify(
      { year, month, executedAt: d.executionStartedAt, completedAt: d.distributedAt,
        status: d.status, totalRecipients: plan.length, recipients: plan, txHashes, failures },
      null, 2), 'utf-8');

    logger.info(`[payout] Distribution ${key} ${d.status} — ${txHashes.length} sent, ${failures.length} failed`);
    return { success: failures.length === 0, distribution: d, plan, txHashes, failures };
  }

  async confirmDistribution(year, month, txHash) {
    const distributions = await this.store.getDistributions();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const d = distributions[key];
    if (!d) return { success: false, error: 'No distribution record' };
    d.status = 'confirmed';
    d.distributedAt = Date.now();
    d.txHash = txHash || null;
    await this.store.saveDistributions();
    logger.info(`[payout] Distribution ${key} CONFIRMED: ${txHash || 'no txHash'}`);
    return { success: true, distribution: d };
  }

  // ─── Summary Stats ───

  async getStats() {
    const apps = await this.store.getApps();
    const users = await this.store.getUsers();
    const orders = await this.store.getOrders();
    const appList = Object.values(apps);
    const orderList = Object.values(orders);
    return {
      success: true,
      stats: {
        appsRegistered: appList.length,
        usersRegistered: Object.values(users).length,
        totalOrders: orderList.length,
        totalRevenue: orderList.reduce((s, o) => s + o.amount, 0),
        apps: appList.map(a => ({
          appId: a.appId,
          name: a.name,
          developerEVM: a.developerEVM,
          feePercent: a.feePercent,
          userCount: a.userCount || 0,
          totalRevenue: a.totalRevenue || 0
        }))
      }
    };
  }
}
