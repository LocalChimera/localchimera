// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/VolunteerEscrow.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VolunteerEscrowTest is Test {
    VolunteerEscrow escrow;
    address admin = address(0xA);
    address coordinator = address(0xC);
    address settlement = address(0x5E77);
    address consumer = address(0xB0B);
    bytes32 constant COORD = keccak256("COORDINATOR_ROLE");

    function setUp() public {
        VolunteerEscrow impl = new VolunteerEscrow();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VolunteerEscrow.initialize.selector, admin, settlement, coordinator
            )
        );
        escrow = VolunteerEscrow(payable(address(proxy)));
        vm.deal(consumer, 10 ether);
    }

    function testCreateAndComplete() public {
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("INFERENCE:prompt", 0, 0);

        vm.prank(coordinator);
        escrow.completeJob(jobId, keccak256("result"), "wsp:volunteer1");

        (address c, uint256 amount,, , bool completed, bool refunded) = escrow.jobs(jobId);
        assertEq(c, consumer);
        assertEq(amount, 1 ether);
        assertTrue(completed);
        assertFalse(refunded);
        assertEq(settlement.balance, 1 ether);
        assertEq(address(escrow).balance, 0);
    }

    function testCoordinatorCannotRedirectFunds() public {
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 2 ether}("COMPUTE:x", 2, 0);
        // coordinator completes — funds still go to settlement, never coordinator
        vm.prank(coordinator);
        escrow.completeJob(jobId, bytes32(uint256(1)), "wsp:v2");
        assertEq(settlement.balance, 2 ether);
        assertEq(coordinator.balance, 0);
    }

    function testCompleteRequiresCoordinatorRole() public {
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("p", 0, 0);
        vm.expectRevert();
        vm.prank(consumer);
        escrow.completeJob(jobId, bytes32(0), "wsp:x");
    }

    function testRefundAfterDeadline() public {
        uint64 dl = uint64(block.timestamp + 100);
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("p", 0, dl);
        vm.warp(block.timestamp + 200);
        uint256 before = consumer.balance;
        vm.prank(consumer);
        escrow.refundJob(jobId);
        assertEq(consumer.balance, before + 1 ether);
    }

    function testRefundRejectsBeforeDeadline() public {
        uint64 dl = uint64(block.timestamp + 1000);
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("p", 0, dl);
        vm.expectRevert(VolunteerEscrow.JobNotExpired.selector);
        vm.prank(consumer);
        escrow.refundJob(jobId);
    }

    function testDoubleResolveReverts() public {
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("p", 0, 0);
        vm.prank(coordinator);
        escrow.completeJob(jobId, bytes32(0), "wsp:x");
        vm.expectRevert(VolunteerEscrow.JobAlreadyResolved.selector);
        vm.prank(coordinator);
        escrow.completeJob(jobId, bytes32(0), "wsp:x");
    }

    function testSettlementSetterAdminOnly() public {
        vm.expectRevert();
        vm.prank(coordinator);
        escrow.setSettlementAddress(address(0x9999));
        vm.prank(admin);
        escrow.setSettlementAddress(address(0x9999));
        assertEq(escrow.settlementAddress(), address(0x9999));
    }

    function testUpgradeAuthority() public {
        VolunteerEscrow v2 = new VolunteerEscrow();
        vm.expectRevert();
        vm.prank(coordinator);
        escrow.upgradeToAndCall(address(v2), "");
        vm.prank(admin);
        escrow.upgradeToAndCall(address(v2), "");
        // state survives the upgrade
        vm.prank(consumer);
        bytes32 jobId = escrow.createJob{value: 1 ether}("post-upgrade", 1, 0);
        vm.prank(coordinator);
        escrow.completeJob(jobId, bytes32(0), "wsp:x");
        assertEq(settlement.balance, 1 ether);
    }

    function testCannotReinitialize() public {
        vm.expectRevert();
        escrow.initialize(admin, settlement, coordinator);
    }
}
