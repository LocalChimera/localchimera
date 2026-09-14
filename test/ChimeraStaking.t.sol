// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ChimeraToken.sol";
import "../contracts/ChimeraStaking.sol";

contract ChimeraStakingTest is Test {
    ChimeraToken token;
    ChimeraStaking staking;
    address admin = address(this);
    address provider = address(0xBEEF);
    address consumer = address(0xCAFE);

    uint256 constant MIN_STAKE = 10_000 * 10 ** 18;

    function setUp() public {
        token = new ChimeraToken(admin, admin);
        staking = new ChimeraStaking(address(token), admin);

        // Give tokens to provider
        token.transfer(provider, 1_000_000 * 10 ** 18);

        // Provider approves staking
        vm.startPrank(provider);
        token.approve(address(staking), type(uint256).max);
        vm.stopPrank();
    }

    function test_Stake() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE, 0);
        (uint256 staked,,,,) = staking.getStake(provider);
        assertEq(staked, MIN_STAKE);
        assertEq(staking.totalStaked(), MIN_STAKE);
        vm.stopPrank();
    }

    function test_StakeWithLock() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE, 90);
        (uint256 staked,,, uint256 unlockAt,) = staking.getStake(provider);
        assertEq(staked, MIN_STAKE);
        assertGt(unlockAt, block.timestamp);
        vm.stopPrank();
    }

    function test_BelowMinStakeReverts() public {
        vm.startPrank(provider);
        vm.expectRevert(ChimeraStaking.BelowMinimumStake.selector);
        staking.stake(MIN_STAKE - 1, 0);
        vm.stopPrank();
    }

    function test_InvalidLockPeriodReverts() public {
        vm.startPrank(provider);
        vm.expectRevert(ChimeraStaking.InvalidLockPeriod.selector);
        staking.stake(MIN_STAKE, 7);
        vm.stopPrank();
    }

    function test_Unstake() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE * 2, 0);
        staking.unstake(MIN_STAKE);
        (uint256 staked,, , , uint256 unstakeAvailableAt) = staking.getStake(provider);
        assertEq(staked, MIN_STAKE);
        assertGt(unstakeAvailableAt, block.timestamp);
        vm.stopPrank();
    }

    function test_ClaimUnstakeAfterDelay() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE * 2, 0);
        staking.unstake(MIN_STAKE);

        // Warp past 7-day delay
        vm.warp(block.timestamp + 8 days);
        staking.claimUnstake();

        (uint256 staked,,,,) = staking.getStake(provider);
        assertEq(staked, MIN_STAKE);
        assertEq(token.balanceOf(provider), 1_000_000 * 10 ** 18 - MIN_STAKE);
        vm.stopPrank();
    }

    function test_EarlyExitBurnsPenalty() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE, 365);
        uint256 balBefore = token.balanceOf(provider);

        // Unstake before lock matures (10% penalty burned)
        staking.unstake(MIN_STAKE);

        // Warp past delay
        vm.warp(block.timestamp + 8 days);
        staking.claimUnstake();

        // Should receive 90% (10% burned)
        uint256 received = token.balanceOf(provider) - balBefore;
        assertEq(received, MIN_STAKE * 9000 / 10000);
        vm.stopPrank();
    }

    function test_Slash() public {
        vm.startPrank(provider);
        staking.stake(MIN_STAKE, 0);
        vm.stopPrank();

        // Grant coordinator role to this test
        staking.grantRole(staking.COORDINATOR_ROLE(), address(this));

        uint256 consumerBalBefore = token.balanceOf(consumer);
        staking.slash(provider, consumer, 5000 * 10 ** 18);

        // 1st offense: 3% slash = 300 CHIMERA
        // consumer refunded min(300, 5000) = 300
        assertEq(token.balanceOf(consumer), consumerBalBefore + 300 * 10 ** 18);
        (uint256 staked,,,,) = staking.getStake(provider);
        assertEq(staked, MIN_STAKE - 300 * 10 ** 18);
    }

    function test_GradientSlashing() public {
        vm.startPrank(provider);
        staking.stake(1_000_000 * 10 ** 18, 0);
        vm.stopPrank();

        staking.grantRole(staking.COORDINATOR_ROLE(), address(this));

        // 1st offense: 3% = 30000 CHIMERA
        staking.slash(provider, consumer, 1000 * 10 ** 18);
        (uint256 staked1,, ) = staking.getSlashInfo(provider);
        (uint256 s1,,,,) = staking.getStake(provider);
        assertEq(s1, 1_000_000 * 10 ** 18 - 30_000 * 10 ** 18);

        // 2nd offense: 5% of remaining
        staking.slash(provider, consumer, 1000 * 10 ** 18);
        (uint256 slashCount,,) = staking.getSlashInfo(provider);
        assertEq(slashCount, 2);

        // 3rd offense: 10%
        staking.slash(provider, consumer, 1000 * 10 ** 18);
        (slashCount,,) = staking.getSlashInfo(provider);
        assertEq(slashCount, 3);
    }

    function test_OffenseReset() public {
        vm.startPrank(provider);
        staking.stake(1_000_000 * 10 ** 18, 0);
        vm.stopPrank();

        staking.grantRole(staking.COORDINATOR_ROLE(), address(this));

        // Slash once
        staking.slash(provider, consumer, 1000 * 10 ** 18);
        (uint256 slashCount,,) = staking.getSlashInfo(provider);
        assertEq(slashCount, 1);

        // Complete 100 successful jobs
        for (uint256 i = 0; i < 100; i++) {
            staking.incrementSuccessfulJobs(provider);
        }

        (slashCount,,) = staking.getSlashInfo(provider);
        assertEq(slashCount, 0);
    }

    function test_ConsumerBoostStake() public {
        token.transfer(consumer, 50_000 * 10 ** 18);
        vm.startPrank(consumer);
        token.approve(address(staking), type(uint256).max);
        staking.consumerBoostStake(10_000 * 10 ** 18);
        assertEq(staking.consumerBoostBalance(consumer), 10_000 * 10 ** 18);
        staking.consumerBoostUnstake(10_000 * 10 ** 18);
        assertEq(staking.consumerBoostBalance(consumer), 0);
        vm.stopPrank();
    }

    function test_PremiumBurn() public {
        vm.startPrank(provider);
        staking.stake(200_000 * 10 ** 18, 0);

        // Burn for priority routing (50K CHIMERA)
        uint256 balBefore = token.balanceOf(provider);
        staking.burnForPremium(provider, 0);
        (bool priorityRouting,,) = staking.getPremiumStatus(provider);
        assertTrue(priorityRouting);
        assertEq(token.balanceOf(provider), balBefore - 50_000 * 10 ** 18);
        vm.stopPrank();
    }

    function test_Referral() public {
        // Provider stakes enough to be a referrer (1K+)
        vm.startPrank(provider);
        staking.stake(MIN_STAKE, 0);
        vm.stopPrank();

        // New user sets referrer
        address newUser = address(0x1234);
        token.transfer(newUser, MIN_STAKE);
        vm.startPrank(newUser);
        token.approve(address(staking), type(uint256).max);
        staking.setReferrer(provider);
        (address referrer,,) = staking.getReferralInfo(newUser);
        assertEq(referrer, provider);
        vm.stopPrank();
    }

    function test_CircuitBreaker() public {
        vm.startPrank(provider);
        staking.stake(100_000 * 10 ** 18, 0);
        vm.stopPrank();

        staking.grantRole(staking.COORDINATOR_ROLE(), address(this));

        // Slash 20%+ of total staked in 24h should trigger circuit breaker
        // 5th offense: 50% slash = 50000, which is 50% of 100000 > 20%
        for (uint256 i = 0; i < 5; i++) {
            staking.slash(provider, consumer, 100 * 10 ** 18);
        }

        (,, bool triggered) = staking.getCircuitBreakerStatus();
        assertTrue(triggered);
    }
}
