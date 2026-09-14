// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChimeraToken
 * @notice Fixed-supply ERC-20 token for the Chimera DePIN platform.
 * @dev 1,000,000,000 (1B) fixed supply minted to the launch recipient at construction.
 *      No mint function, no transfer tax, no backdoor. Burnable for slashing, PoI
 *      settlement, premium features, early lock exit, and auto-buyback.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ChimeraToken is ERC20Burnable, AccessControl {
    /// @notice Total fixed supply: 1 billion tokens with 18 decimals.
    uint256 public constant FIXED_SUPPLY = 1_000_000_000 * 10 ** 18;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    event TokensBurned(address indexed burner, uint256 amount);

    error ZeroAddressRecipient();
    error NoMintAllowed();

    /**
     * @param launchRecipient Address receiving the full 1B fixed supply at launch
     *        (typically the PONS V2 bonding curve or a manual Uniswap V4 pool).
     * @param admin           Default admin (governance/timelock).
     */
    constructor(address launchRecipient, address admin) ERC20("Chimera", "CHIMERA") {
        if (launchRecipient == address(0)) revert ZeroAddressRecipient();
        if (admin == address(0)) revert ZeroAddressRecipient();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);

        _mint(launchRecipient, FIXED_SUPPLY);
    }

    /**
     * @notice Burn tokens from the caller's own balance.
     * @dev Overrides ERC20Burnable.burn to emit a protocol-level event.
     */
    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TokensBurned(_msgSender(), amount);
    }

    /**
     * @notice Burn tokens from an allowance.
     * @dev Overrides ERC20Burnable.burnFrom to emit a protocol-level event.
     */
    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
        emit TokensBurned(_msgSender(), amount);
    }

    /**
     * @notice Explicitly disabled. Supply is fixed at 1B. There is no mint path.
     * @dev Calling this function always reverts. It exists only to make the
     *      "no mint" guarantee auditable and self-documenting on-chain.
     */
    function mint(address, uint256) external pure {
        revert NoMintAllowed();
    }
}
