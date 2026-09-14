import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { robinhoodChain, CHIMERA_CONTRACTS } from './chains';

interface PremiumStatus {
  priorityRouting: boolean;
  higherThroughput: boolean;
  customPricing: boolean;
}

interface StakeInfo {
  staked: bigint;
  weight: bigint;
  lockMultiplier: bigint;
  unlockAt: bigint;
  unstakeAvailableAt: bigint;
}

interface VestingInfo {
  totalVested: bigint;
  claimed: bigint;
  available: bigint;
  vestStart: bigint;
  vestEnd: bigint;
}

interface CircuitBreakerStatus {
  slashVolume24h: bigint;
  totalStaked: bigint;
  triggered: boolean;
}

interface ChimeraContextValue {
  address: string | null;
  chainId: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  escrowAddress: string;
  coordinatorAddress: string;
  // v2 tokenomics
  chimeraTokenAddress: string;
  stakingAddress: string;
  governanceAddress: string;
  chimeraBalance: bigint;
  stakeInfo: StakeInfo | null;
  vestingInfo: VestingInfo | null;
  premiumStatus: PremiumStatus | null;
  votingPower: bigint;
  circuitBreaker: CircuitBreakerStatus | null;
  providerTier: number;
  refreshTokenomics: () => Promise<void>;
}

const ChimeraContext = createContext<ChimeraContextValue>({
  address: null,
  chainId: 4663,
  connect: async () => {},
  disconnect: () => {},
  escrowAddress: '',
  coordinatorAddress: '',
  chimeraTokenAddress: '',
  stakingAddress: '',
  governanceAddress: '',
  chimeraBalance: 0n,
  stakeInfo: null,
  vestingInfo: null,
  premiumStatus: null,
  votingPower: 0n,
  circuitBreaker: null,
  providerTier: 2,
  refreshTokenomics: async () => {},
});

export function useChimera(): ChimeraContextValue {
  return useContext(ChimeraContext);
}

const CHIMERA_TOKEN_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

const CHIMERA_STAKING_ABI = parseAbi([
  'function getStake(address provider) view returns (uint256 staked, uint256 weight, uint256 lockMultiplier, uint256 unlockAt, uint256 unstakeAvailableAt)',
  'function getVestingInfo(address staker) view returns (uint256 totalVested, uint256 claimed, uint256 available, uint256 vestStart, uint256 vestEnd)',
  'function getPremiumStatus(address provider) view returns (bool priorityRouting, bool higherThroughput, bool customPricing)',
  'function getCircuitBreakerStatus() view returns (uint256 slashVolume24h, uint256 totalStaked, bool triggered)',
  'function totalStaked() view returns (uint256)',
]);

function getPublicClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(),
  });
}

export function ChimeraWeb3AuthProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chimeraBalance, setChimeraBalance] = useState<bigint>(0n);
  const [stakeInfo, setStakeInfo] = useState<StakeInfo | null>(null);
  const [vestingInfo, setVestingInfo] = useState<VestingInfo | null>(null);
  const [premiumStatus, setPremiumStatus] = useState<PremiumStatus | null>(null);
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerStatus | null>(null);
  const [providerTier, setProviderTier] = useState<number>(2);

  const refreshTokenomics = useCallback(async () => {
    if (!address) return;
    const client = getPublicClient();
    const tokenAddr = CHIMERA_CONTRACTS.chimeraToken as `0x${string}`;
    const stakingAddr = CHIMERA_CONTRACTS.chimeraStaking as `0x${string}`;
    if (tokenAddr === '0x' || stakingAddr === '0x') return;

    try {
      const balance = await client.readContract({
        address: tokenAddr,
        abi: CHIMERA_TOKEN_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      }) as bigint;
      setChimeraBalance(balance);
    } catch { setChimeraBalance(0n); }

    try {
      const stake = await client.readContract({
        address: stakingAddr,
        abi: CHIMERA_STAKING_ABI,
        functionName: 'getStake',
        args: [address as `0x${string}`],
      }) as [bigint, bigint, bigint, bigint, bigint];
      setStakeInfo({
        staked: stake[0], weight: stake[1], lockMultiplier: stake[2],
        unlockAt: stake[3], unstakeAvailableAt: stake[4],
      });
      setProviderTier(stake[0] > 0n ? 1 : 2);
    } catch { setStakeInfo(null); setProviderTier(2); }

    try {
      const vesting = await client.readContract({
        address: stakingAddr,
        abi: CHIMERA_STAKING_ABI,
        functionName: 'getVestingInfo',
        args: [address as `0x${string}`],
      }) as [bigint, bigint, bigint, bigint, bigint];
      setVestingInfo({
        totalVested: vesting[0], claimed: vesting[1], available: vesting[2],
        vestStart: vesting[3], vestEnd: vesting[4],
      });
    } catch { setVestingInfo(null); }

    try {
      const premium = await client.readContract({
        address: stakingAddr,
        abi: CHIMERA_STAKING_ABI,
        functionName: 'getPremiumStatus',
        args: [address as `0x${string}`],
      }) as [boolean, boolean, boolean];
      setPremiumStatus({
        priorityRouting: premium[0], higherThroughput: premium[1], customPricing: premium[2],
      });
    } catch { setPremiumStatus(null); }

    try {
      const cb = await client.readContract({
        address: stakingAddr,
        abi: CHIMERA_STAKING_ABI,
        functionName: 'getCircuitBreakerStatus',
      }) as [bigint, bigint, boolean];
      setCircuitBreaker({
        slashVolume24h: cb[0], totalStaked: cb[1], triggered: cb[2],
      });
    } catch { setCircuitBreaker(null); }
  }, [address]);

  useEffect(() => {
    if (address) {
      refreshTokenomics();
      const interval = setInterval(refreshTokenomics, 30000);
      return () => clearInterval(interval);
    }
  }, [address, refreshTokenomics]);

  const connect = useCallback(async () => {
    const provider = (window as any).ethereum;
    if (!provider) {
      alert('Please install MetaMask or a Web3 wallet');
      return;
    }
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
    } catch {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x1237',
            chainName: 'Robinhood Chain',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
            blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
          }],
        });
      } catch (e) {
        console.error('Failed to add chain:', e);
      }
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    setAddress(accounts[0]);
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChimeraBalance(0n);
    setStakeInfo(null);
    setVestingInfo(null);
    setPremiumStatus(null);
    setCircuitBreaker(null);
    setProviderTier(2);
  }, []);

  return (
    <ChimeraContext.Provider value={{
      address,
      chainId: robinhoodChain.id,
      connect,
      disconnect,
      escrowAddress: CHIMERA_CONTRACTS.escrow,
      coordinatorAddress: CHIMERA_CONTRACTS.coordinator,
      chimeraTokenAddress: CHIMERA_CONTRACTS.chimeraToken,
      stakingAddress: CHIMERA_CONTRACTS.chimeraStaking,
      governanceAddress: CHIMERA_CONTRACTS.chimeraGovernance,
      chimeraBalance,
      stakeInfo,
      vestingInfo,
      premiumStatus,
      votingPower: stakeInfo?.staked ?? 0n,
      circuitBreaker,
      providerTier,
      refreshTokenomics,
    }}>
      {children}
    </ChimeraContext.Provider>
  );
}
