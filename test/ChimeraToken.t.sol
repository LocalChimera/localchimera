// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ChimeraToken.sol";

contract ChimeraTokenTest is Test {
    ChimeraToken token;
    address admin = address(this);
    address recipient = address(0xBEEF);

    function setUp() public {
        token = new ChimeraToken(recipient, admin);
    }

    function test_Name() public view {
        assertEq(token.name(), "Chimera");
    }

    function test_Symbol() public view {
        assertEq(token.symbol(), "CHIMERA");
    }

    function test_Decimals() public view {
        assertEq(token.decimals(), 18);
    }

    function test_FixedSupply() public view {
        assertEq(token.totalSupply(), 1_000_000_000 * 10 ** 18);
    }

    function test_SupplyMintedToRecipient() public view {
        assertEq(token.balanceOf(recipient), 1_000_000_000 * 10 ** 18);
    }

    function test_Burn() public {
        vm.startPrank(recipient);
        uint256 balBefore = token.balanceOf(recipient);
        token.burn(1000 * 10 ** 18);
        assertEq(token.balanceOf(recipient), balBefore - 1000 * 10 ** 18);
        assertEq(token.totalSupply(), 1_000_000_000 * 10 ** 18 - 1000 * 10 ** 18);
        vm.stopPrank();
    }

    function test_BurnFrom() public {
        vm.startPrank(recipient);
        token.approve(address(this), 500 * 10 ** 18);
        vm.stopPrank();

        uint256 balBefore = token.balanceOf(recipient);
        token.burnFrom(recipient, 500 * 10 ** 18);
        assertEq(token.balanceOf(recipient), balBefore - 500 * 10 ** 18);
    }

    function test_MintReverts() public {
        vm.expectRevert(ChimeraToken.NoMintAllowed.selector);
        token.mint(address(0xCAFE), 1000);
    }

    function test_NoTransferTax() public {
        vm.startPrank(recipient);
        uint256 balBefore = token.balanceOf(recipient);
        token.transfer(address(0xCAFE), 100 * 10 ** 18);
        assertEq(token.balanceOf(address(0xCAFE)), 100 * 10 ** 18);
        assertEq(token.balanceOf(recipient), balBefore - 100 * 10 ** 18);
        vm.stopPrank();
    }

    function test_ZeroAddressRecipientReverts() public {
        vm.expectRevert(ChimeraToken.ZeroAddressRecipient.selector);
        new ChimeraToken(address(0), admin);
    }
}
