// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../../contracts/ProofOfInferenceVerifier.sol";
import "../../contracts/ChimeraCoordinator.sol";
import "../../contracts/EscrowChannel.sol";

/**
 * @title DeployChimeraRobinhood
 * @notice Deploys Chimera contracts to Robinhood Chain (chain ID 4663).
 *
 * Deploys:
 *   1. EscrowChannel — ERC-8184 streaming micropayment channel
 *   2. ProofOfInferenceVerifier — on-chain inference receipt verification
 *   3. ChimeraCoordinator — job routing with AccessControl
 *
 * Environment:
 *   PRIVATE_KEY       — deployer private key
 *   USDT_ADDRESS      — USDT token address for ProofOfInferenceVerifier (optional, defaults to address(0))
 *   ESCROW_OWNER      — escrow channel owner (defaults to deployer)
 *   PROTOCOL_FEE_BPS  — protocol fee in basis points (default: 0)
 *
 * Usage:
 *   forge script scripts/deploy/DeployChimeraRobinhood.s.sol:DeployChimeraRobinhood \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com \
 *     --private-key $PRIVATE_KEY --broadcast
 */
contract DeployChimeraRobinhood is Script {
    function run() public {
        address deployer = msg.sender;
        address usdtAddress = vm.envOr("USDT_ADDRESS", address(0));
        address paymentToken = vm.envOr("PAYMENT_TOKEN", usdtAddress);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint256 platformFeeBps = vm.envOr("PLATFORM_FEE_BPS", uint256(0));

        vm.startBroadcast();

        console.log("========================================");
        console.log("Chimera Robinhood Chain Deployment");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Payment Token:", paymentToken);
        console.log("Fee Recipient:", feeRecipient);
        console.log("Platform Fee BPS:", platformFeeBps);

        // 1. EscrowChannel (ERC-8184)
        EscrowChannel escrow = new EscrowChannel(paymentToken, uint16(platformFeeBps), feeRecipient);
        console.log("EscrowChannel deployed at:", address(escrow));

        // 2. ProofOfInferenceVerifier
        ProofOfInferenceVerifier poiVerifier = new ProofOfInferenceVerifier(usdtAddress);
        console.log("ProofOfInferenceVerifier deployed at:", address(poiVerifier));

        // 3. ChimeraCoordinator (requires escrow + registry)
        // Note: ComputeRegistry address must be set after deployment
        // For now, deploy with placeholder and update via setEscrow/setRegistry
        address registryPlaceholder = address(0);
        ChimeraCoordinator coordinator = new ChimeraCoordinator(
            address(escrow),
            registryPlaceholder
        );
        console.log("ChimeraCoordinator deployed at:", address(coordinator));

        console.log("========================================");
        console.log("Deployment complete!");
        console.log("========================================");
        console.log('"escrowChannel": "%s",', address(escrow));
        console.log('"proofOfInferenceVerifier": "%s",', address(poiVerifier));
        console.log('"chimeraCoordinator": "%s"', address(coordinator));

        vm.stopBroadcast();
    }
}
