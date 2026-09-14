// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IOrderBook.sol";
import "./interfaces/IComputeRegistry.sol";
import "./libraries/Utils.sol";

/// @title OrderBook
/// @notice On-chain order book mirror for limit orders and matchmaking
/// @dev Implements the Order Book from the decentralized compute marketplace architecture
contract OrderBook is IOrderBook, Ownable {
    using MathLib for uint256;
    using ValidationLib for uint256;
    using ValidationLib for uint64;
    using ValidationLib for address;
    using ValidationLib for string;
    using TimeLib for uint256;
    using BytesLib for bytes32;

    // State
    mapping(bytes32 => Order) public orders;
    mapping(address => bytes32[]) public userOrders;
    
    // Active orders indexed by taskType + modelId for efficient querying
    mapping(uint64 => mapping(string => bytes32[])) public activeBids;
    mapping(uint64 => mapping(string => bytes32[])) public activeAsks;
    
    mapping(bytes32 => Match) public matches;
    mapping(address => bytes32[]) public providerMatches;
    mapping(address => bytes32[]) public consumerMatches;

    address public immutable computeRegistry;

    // Constants
    uint256 public constant MIN_PRICE = 1;
    uint256 public constant MAX_EXPIRY = 365 days;

    constructor(address _computeRegistry, address _owner) Ownable(_owner) {
        computeRegistry = _computeRegistry;
    }

    modifier orderExists(bytes32 orderId) {
        require(orders[orderId].orderId != bytes32(0), "OrderBook: order not found");
        _;
    }

    modifier onlyOrderOwner(bytes32 orderId) {
        require(orders[orderId].providerAuthority == msg.sender || 
                (orders[orderId].side == uint8(OrderSide.Bid) && orders[orderId].status != uint8(OrderStatus.Cancelled)), 
                "OrderBook: not order owner");
        _;
    }

    function placeOrder(
        uint8 side,
        uint256 pricePerRequest,
        uint64 taskType,
        uint256 quantity,
        uint256 expiry,
        string calldata modelId,
        bytes calldata signature
    ) external override returns (bytes32 orderId) {
        // Validations
        require(side == uint8(OrderSide.Bid) || side == uint8(OrderSide.Ask), "OrderBook: invalid side");
        pricePerRequest.validatePrice(MIN_PRICE);
        quantity.validateQuantity();
        taskType.validateTaskType();
        require(expiry > block.timestamp && expiry <= block.timestamp + MAX_EXPIRY, "OrderBook: invalid expiry");
        
        // For asks, verify provider is registered
        if (side == uint8(OrderSide.Ask)) {
            IComputeRegistry registry = IComputeRegistry(computeRegistry);
            require(registry.getProviderByAuthority(msg.sender) != address(0), "OrderBook: provider not registered");
            require(registry.isActiveProvider(registry.getProviderByAuthority(msg.sender)), "OrderBook: provider not active");
        }

        // Generate deterministic order ID
        orderId = keccak256(abi.encodePacked(msg.sender, side, pricePerRequest, taskType, quantity, expiry, modelId, block.timestamp, block.prevrandao));
        require(orders[orderId].orderId == bytes32(0), "OrderBook: duplicate order ID");

        // Create order
        Order storage order = orders[orderId];
        order.orderId = orderId;
        order.providerAuthority = msg.sender;
        order.side = side;
        order.pricePerRequest = pricePerRequest;
        order.taskType = taskType;
        order.quantity = quantity;
        order.filledQuantity = 0;
        order.status = uint8(OrderStatus.Open);
        order.expiry = expiry;
        order.modelId = modelId;
        order.signature = signature;

        // Update user orders
        userOrders[msg.sender].push(orderId);

        // Update active order lists
        if (side == uint8(OrderSide.Bid)) {
            activeBids[taskType][modelId].push(orderId);
        } else {
            activeAsks[taskType][modelId].push(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, OrderSide(side), pricePerRequest, quantity, taskType);
    }

    function cancelOrder(bytes32 orderId) external override orderExists(orderId) {
        Order storage order = orders[orderId];
        
        // Only the order owner can cancel (provider for asks, anyone for bids who placed it)
        // For simplicity, we check if msg.sender is the providerAuthority
        require(order.providerAuthority == msg.sender, "OrderBook: unauthorized");
        require(order.status == uint8(OrderStatus.Open) || order.status == uint8(OrderStatus.PartiallyFilled), "OrderBook: order not cancellable");

        order.status = uint8(OrderStatus.Cancelled);
        
        // Note: We don't remove from active lists to avoid O(n) operations
        // Instead, we check status when querying
        
        emit OrderCancelled(orderId, msg.sender);
    }

    function fillOrder(bytes32 orderId, uint256 fillQuantity) external override orderExists(orderId) returns (uint256) {
        Order storage order = orders[orderId];
        require(order.status == uint8(OrderStatus.Open) || order.status == uint8(OrderStatus.PartiallyFilled), "OrderBook: order not fillable");
        require(!order.expiry.isExpired(), "OrderBook: order expired");
        require(fillQuantity > 0, "OrderBook: fill quantity must be positive");
        
        uint256 remaining = order.quantity - order.filledQuantity;
        uint256 actualFill = fillQuantity < remaining ? fillQuantity : remaining;
        
        order.filledQuantity += actualFill;
        
        if (order.filledQuantity >= order.quantity) {
            order.status = uint8(OrderStatus.Filled);
        } else {
            order.status = uint8(OrderStatus.PartiallyFilled);
        }

        emit OrderFilled(orderId, order.providerAuthority, actualFill);
        return actualFill;
    }

    function recordMatch(
        bytes32 bidOrderId,
        bytes32 askOrderId,
        uint256 price,
        uint256 quantity,
        address consumer,
        address provider
    ) external override onlyOwner returns (bytes32 matchId) {
        Order storage bidOrder = orders[bidOrderId];
        Order storage askOrder = orders[askOrderId];
        
        require(bidOrder.orderId != bytes32(0), "OrderBook: bid order not found");
        require(askOrder.orderId != bytes32(0), "OrderBook: ask order not found");
        require(bidOrder.side == uint8(OrderSide.Bid), "OrderBook: not a bid order");
        require(askOrder.side == uint8(OrderSide.Ask), "OrderBook: not an ask order");
        require(bidOrder.pricePerRequest >= askOrder.pricePerRequest, "OrderBook: bid price below ask");
        require(bidOrder.taskType == askOrder.taskType, "OrderBook: task type mismatch");
        
        // Generate deterministic match ID
        matchId = keccak256(abi.encodePacked(bidOrderId, askOrderId, quantity, block.timestamp));
        require(matches[matchId].matchId == bytes32(0), "OrderBook: duplicate match ID");

        Match storage matchRecord = matches[matchId];
        matchRecord.matchId = matchId;
        matchRecord.bidOrderId = bidOrderId;
        matchRecord.askOrderId = askOrderId;
        matchRecord.price = price;
        matchRecord.quantity = quantity;
        matchRecord.timestamp = block.timestamp;
        matchRecord.consumer = consumer;
        matchRecord.provider = provider;

        // Update orders
        bidOrder.filledQuantity += quantity;
        if (bidOrder.filledQuantity >= bidOrder.quantity) {
            bidOrder.status = uint8(OrderStatus.Filled);
        } else {
            bidOrder.status = uint8(OrderStatus.PartiallyFilled);
        }
        
        askOrder.filledQuantity += quantity;
        if (askOrder.filledQuantity >= askOrder.quantity) {
            askOrder.status = uint8(OrderStatus.Filled);
        } else {
            askOrder.status = uint8(OrderStatus.PartiallyFilled);
        }

        // Update match indexes
        providerMatches[provider].push(matchId);
        consumerMatches[consumer].push(matchId);

        emit OrdersMatched(matchId, bidOrderId, askOrderId, price, quantity, consumer, provider);
    }

    function getOrder(bytes32 orderId) external view override returns (Order memory) {
        return orders[orderId];
    }

    function getActiveBids(uint64 taskType, string calldata modelId) external view override returns (bytes32[] memory orderIds) {
        return activeBids[taskType][modelId];
    }

    function getActiveAsks(uint64 taskType, string calldata modelId) external view override returns (bytes32[] memory orderIds) {
        return activeAsks[taskType][modelId];
    }

    function getBestBid(uint64 taskType, string calldata modelId) external view override returns (Order memory) {
        bytes32[] storage bids = activeBids[taskType][modelId];
        uint256 bestPrice = 0;
        bytes32 bestOrderId;
        
        for (uint256 i = 0; i < bids.length; i++) {
            Order storage order = orders[bids[i]];
            if (order.status == uint8(OrderStatus.Open) && !order.expiry.isExpired()) {
                if (order.pricePerRequest > bestPrice) {
                    bestPrice = order.pricePerRequest;
                    bestOrderId = order.orderId;
                }
            }
        }
        
        return orders[bestOrderId];
    }

    function getBestAsk(uint64 taskType, string calldata modelId) external view override returns (Order memory) {
        bytes32[] storage asks = activeAsks[taskType][modelId];
        uint256 bestPrice = type(uint256).max;
        bytes32 bestOrderId;
        
        for (uint256 i = 0; i < asks.length; i++) {
            Order storage order = orders[asks[i]];
            if (order.status == uint8(OrderStatus.Open) && !order.expiry.isExpired()) {
                if (order.pricePerRequest < bestPrice) {
                    bestPrice = order.pricePerRequest;
                    bestOrderId = order.orderId;
                }
            }
        }
        
        return orders[bestOrderId];
    }

    function getMatches(address provider, uint256 startTime) external view override returns (Match[] memory) {
        bytes32[] storage matchIds = providerMatches[provider];
        Match[] memory result = new Match[](matchIds.length);
        
        for (uint256 i = 0; i < matchIds.length; i++) {
            Match storage matchRecord = matches[matchIds[i]];
            if (matchRecord.timestamp >= startTime) {
                result[i] = matchRecord;
            }
        }
        
        return result;
    }

    function getUserOrders(address user) external view override returns (bytes32[] memory orderIds) {
        return userOrders[user];
    }

    // Admin function to clean up expired orders
    function cleanupExpiredOrders(uint64 taskType, string calldata modelId) external onlyOwner {
        // Clean bids
        bytes32[] storage bids = activeBids[taskType][modelId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (orders[bids[i]].expiry.isExpired()) {
                orders[bids[i]].status = uint8(OrderStatus.Cancelled);
            }
        }
        
        // Clean asks
        bytes32[] storage asks = activeAsks[taskType][modelId];
        for (uint256 i = 0; i < asks.length; i++) {
            if (orders[asks[i]].expiry.isExpired()) {
                orders[asks[i]].status = uint8(OrderStatus.Cancelled);
            }
        }
    }
}