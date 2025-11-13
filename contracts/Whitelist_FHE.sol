pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WhitelistFHE is ZamaEthereumConfig {
    struct WhitelistEntry {
        euint32 encryptedAddress;  // Encrypted address hash
        uint256 depositAmount;     // Public deposit amount
        uint256 timestamp;         // Registration timestamp
        bool verified;             // Verification status
    }

    mapping(string => WhitelistEntry) public whitelist;
    string[] public whitelistIds;

    event WhitelistEntryCreated(string indexed entryId, address indexed creator);
    event VerificationCompleted(string indexed entryId, bool isValid);

    constructor() ZamaEthereumConfig() {
    }

    function registerToWhitelist(
        string calldata entryId,
        externalEuint32 encryptedAddress,
        bytes calldata inputProof,
        uint256 depositAmount
    ) external {
        require(bytes(whitelist[entryId].encryptedAddress).length == 0, "Entry already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAddress, inputProof)), "Invalid encrypted input");

        whitelist[entryId] = WhitelistEntry({
            encryptedAddress: FHE.fromExternal(encryptedAddress, inputProof),
            depositAmount: depositAmount,
            timestamp: block.timestamp,
            verified: false
        });

        FHE.allowThis(whitelist[entryId].encryptedAddress);
        FHE.makePubliclyDecryptable(whitelist[entryId].encryptedAddress);

        whitelistIds.push(entryId);
        emit WhitelistEntryCreated(entryId, msg.sender);
    }

    function verifyWhitelistEntry(
        string calldata entryId,
        bytes memory abiEncodedClearAddress,
        bytes memory decryptionProof
    ) external {
        require(bytes(whitelist[entryId].encryptedAddress).length > 0, "Entry does not exist");
        require(!whitelist[entryId].verified, "Entry already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(whitelist[entryId].encryptedAddress);

        FHE.checkSignatures(cts, abiEncodedClearAddress, decryptionProof);

        whitelist[entryId].verified = true;
        emit VerificationCompleted(entryId, true);
    }

    function getWhitelistEntry(string calldata entryId) external view returns (
        euint32 encryptedAddress,
        uint256 depositAmount,
        uint256 timestamp,
        bool verified
    ) {
        require(bytes(whitelist[entryId].encryptedAddress).length > 0, "Entry does not exist");
        WhitelistEntry storage entry = whitelist[entryId];

        return (
            entry.encryptedAddress,
            entry.depositAmount,
            entry.timestamp,
            entry.verified
        );
    }

    function getAllWhitelistIds() external view returns (string[] memory) {
        return whitelistIds;
    }

    function compareEncryptedAddresses(
        string calldata entryId1,
        string calldata entryId2,
        bytes memory comparisonProof
    ) external view returns (bool isEqual) {
        require(bytes(whitelist[entryId1].encryptedAddress).length > 0, "Entry 1 does not exist");
        require(bytes(whitelist[entryId2].encryptedAddress).length > 0, "Entry 2 does not exist");

        euint32 encryptedAddr1 = whitelist[entryId1].encryptedAddress;
        euint32 encryptedAddr2 = whitelist[entryId2].encryptedAddress;

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(encryptedAddr1);
        cts[1] = FHE.toBytes32(encryptedAddr2);

        bytes memory result = FHE.compare(cts, comparisonProof);
        isEqual = abi.decode(result, (bool));
    }

    function batchVerifyEntries(
        string[] calldata entryIds,
        bytes[] memory abiEncodedClearAddresses,
        bytes[] memory decryptionProofs
    ) external {
        require(entryIds.length == abiEncodedClearAddresses.length, "Array length mismatch");
        require(entryIds.length == decryptionProofs.length, "Array length mismatch");

        for (uint i = 0; i < entryIds.length; i++) {
            string calldata entryId = entryIds[i];
            require(bytes(whitelist[entryId].encryptedAddress).length > 0, "Entry does not exist");
            require(!whitelist[entryId].verified, "Entry already verified");

            bytes32[] memory cts = new bytes32[](1);
            cts[0] = FHE.toBytes32(whitelist[entryId].encryptedAddress);

            FHE.checkSignatures(cts, abiEncodedClearAddresses[i], decryptionProofs[i]);
            whitelist[entryId].verified = true;
            emit VerificationCompleted(entryId, true);
        }
    }

    function getContractStatus() external pure returns (bool operational) {
        return true;
    }
}

