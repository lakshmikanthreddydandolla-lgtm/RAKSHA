// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuditAnchor {
    event RootAnchored(bytes32 indexed root, uint256 indexed batchId, uint256 timestamp);
    mapping(uint256 => bytes32) public roots;

    function anchor(uint256 batchId, bytes32 root) external {
        require(roots[batchId] == bytes32(0), "batch already anchored");
        roots[batchId] = root;
        emit RootAnchored(root, batchId, block.timestamp);
    }
}
