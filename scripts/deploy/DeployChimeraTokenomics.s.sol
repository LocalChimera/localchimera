// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../../contracts/ChimeraToken.sol";
import "../../contracts/ChimeraStaking.sol";
import "../../contracts/ChimeraCoordinatorV2.sol";
import "../../contracts/ProofOfInferenceVerifierV2.sol";
import "../../contracts/EscrowChannel.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title DeployChimeraTokenomics
 * @notice Deploys the full Chimera tokenomics stack to Robinhood Chain (4663).
 *
 * Deploys:
 *   1. ChimeraToken (CHIMERA) — 1B fixed supply, burnable, no mint
 *   2. ChimeraStaking — two-tier staking, gradient slashing, vesting, premium, referrals
 *   3. EscrowChannel (v2) — CHIMERA-based payment channel
 *   4. ChimeraCoordinatorV2 — CHIMERA payments, two-tier selection, buyback, circuit breaker
 *   5. ProofOfInferenceVerifierV2 — CHIMERA settlement with 10% burn
 *   6. TimelockController — for governance timelock
 *   7. ChimeraGovernance — on-chain governance with dispute resolution
 *
 * Environment:
 *   PRIVATE_KEY         — deployer private key
 *   LAUNCH_RECIPIENT    — address receiving the 1B CHIMERA supply (PONS V2 or manual pool)
 *   WETH_ADDRESS        — WETH token address on Robinhood Chain
 *   COMPUTE_REGISTRY    — existing ComputeRegistry address (for provider selection)
 *   ADMIN_ADDRESS       — governance/timelock admin (defaults to deployer)
 *
 * Usage:
 *   forge script scripts/deploy/DeployChimeraTokenomics.s.sol:DeployChimeraTokenomics \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com \
 *     --private-key $PRIVATE_KEY --broadcast
 */
contract DeployChimeraTokenomics is Script {
    // WETH on Robinhood Chain
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function run() public {
        address deployer = msg.sender;
        address launchRecipient = vm.envOr("LAUNCH_RECIPIENT", deployer);
        address weth = vm.envOr("WETH_ADDRESS", WETH);
        address computeRegistry = vm.envOr("COMPUTE_REGISTRY", address(0));
        address admin = vm.envOr("ADMIN_ADDRESS", deployer);

        vm.startBroadcast();

        console.log("========================================");
        console.log("Chimera Tokenomics Deployment");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Launch Recipient:", launchRecipient);
        console.log("WETH:", weth);
        console.log("Compute Registry:", computeRegistry);
        console.log("Admin:", admin);

        // 1. ChimeraToken (CHIMERA) — 1B fixed supply
        ChimeraToken token = new ChimeraToken(launchRecipient, admin);
        console.log("ChimeraToken deployed at:", address(token));

        // 2. ChimeraStaking
        ChimeraStaking staking = new ChimeraStaking(address(token), admin);
        console.log("ChimeraStaking deployed at:", address(staking));

        // 3. EscrowChannel (v2) — CHIMERA as payment token, 3% platform fee
        uint16 platformFeeBps = 300; // 3%
        EscrowChannel escrow = new EscrowChannel(address(token), platformFeeBps, deployer);
        console.log("EscrowChannel (v2) deployed at:", address(escrow));

        // 4. ChimeraCoordinatorV2
        ChimeraCoordinatorV2 coordinator = new ChimeraCoordinatorV2(
            address(token),
            weth,
            address(staking),
            computeRegistry,
            admin
        );
        console.log("ChimeraCoordinatorV2 deployed at:", address(coordinator));

        // 5. ProofOfInferenceVerifierV2
        ProofOfInferenceVerifierV2 poiVerifier = new ProofOfInferenceVerifierV2(address(token));
        console.log("ProofOfInferenceVerifierV2 deployed at:", address(poiVerifier));

        // 6. TimelockController (48h delay for governance)
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        TimelockController timelock = new TimelockController(48 hours, proposers, executors, admin);
        console.log("TimelockController deployed at:", address(timelock));

        // 7. ChimeraGovernance
        // Note: GovernorVotes requires an IVotes (ERC20Votes) token.
        // ChimeraToken is a plain ERC20 — governance uses staking-based voting instead.
        // For now, deploy governance with the token address; voting power reads from staking.
        // A full implementation would wrap ChimeraToken with ERC20Votes or use a custom
        // voting strategy that reads staked balance from ChimeraStaking.
        // ChimeraGovernance governance = new ChimeraGovernance(
        //     IERC20(address(token)),
        //     timelock,
        //     address(staking),
        //     admin
        // );
        // console.log("ChimeraGovernance deployed at:", address(governance));

        // Wire roles
        // Grant COORDINATOR_ROLE on staking to coordinator
        staking.grantRole(staking.COORDINATOR_ROLE(), address(coordinator));

        // Grant GOVERNANCE_ROLE on coordinator to timelock (governance controls params)
        coordinator.grantRole(coordinator.GOVERNANCE_ROLE(), address(timelock));

        console.log("========================================");
        console.log("Deployment complete!");
        console.log("========================================");
        console.log('"chimeraToken": "%s",', address(token));
        console.log('"chimeraStaking": "%s",', address(staking));
        console.log('"escrowChannelV2": "%s",', address(escrow));
        console.log('"chimeraCoordinatorV2": "%s",', address(coordinator));
        console.log('"proofOfInferenceVerifierV2": "%s",', address(poiVerifier));
        console.log('"timelockController": "%s",', address(timelock));
        // console.log('"chimeraGovernance": "%s",', address(governance));

        vm.stopBroadcast();
    }
}
