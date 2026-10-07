// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../../contracts/VolunteerEscrow.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * Deploys VolunteerEscrow (UUPS: implementation + ERC1967Proxy).
 *
 *   forge script scripts/deploy/DeployVolunteerEscrow.s.sol \
 *     --rpc-url https://sepolia.base.org --broadcast --verify
 *
 * Env:
 *   DEPLOYER_KEY   — funded deployer (broadcast key)
 *   ADMIN          — cold wallet; DEFAULT_ADMIN + upgrade authority
 *   SETTLEMENT     — address that receives all escrowed payouts
 *   COORDINATOR    — the Cloudflare worker's task key (gas-only)
 */
contract DeployVolunteerEscrow is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address admin = vm.envAddress("ADMIN");
        address settlement = vm.envAddress("SETTLEMENT");
        address coordinator = vm.envAddress("COORDINATOR");

        vm.startBroadcast(key);

        VolunteerEscrow impl = new VolunteerEscrow();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VolunteerEscrow.initialize.selector, admin, settlement, coordinator
            )
        );

        vm.stopBroadcast();

        console.log("Implementation:", address(impl));
        console.log("Proxy (use this as ESCROW_CONTRACT):", address(proxy));
    }
}
