// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title Wrapped Bitcoin
 * @dev Wrapped Bitcoin for cosmos-evm testnet - pegged 1:1 with Bitcoin
 */
contract WBTC is ERC20, ERC20Burnable, Ownable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address initialOwner) 
        ERC20("Wrapped Bitcoin", "WBTC")
        Ownable()
    {
        // Transfer ownership to the provided initialOwner (faucet)
        _transferOwnership(initialOwner);

        // Grant roles to the initialOwner
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);

        // Mint initial supply to the initialOwner (faucet)
        _mint(initialOwner, 100000000000000); // Wrapped Bitcoin initial supply
    }


    function decimals() public view virtual override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
