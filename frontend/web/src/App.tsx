import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface WhitelistEntry {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEntryData, setNewEntryData] = useState({ name: "", value: "", description: "" });
  const [selectedEntry, setSelectedEntry] = useState<WhitelistEntry | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<Array<{action: string, timestamp: number, target: string}>>([]);
  const [stats, setStats] = useState({total: 0, verified: 0, userCreated: 0});

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadWhitelist();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addUserHistory = (action: string, target: string) => {
    setUserHistory(prev => [{
      action,
      timestamp: Date.now(),
      target
    }, ...prev.slice(0, 9)]);
  };

  const loadWhitelist = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const entries: WhitelistEntry[] = [];
      let userCreatedCount = 0;
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const entry: WhitelistEntry = {
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          };
          entries.push(entry);
          if (businessData.creator.toLowerCase() === address?.toLowerCase()) {
            userCreatedCount++;
          }
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setWhitelist(entries);
      setStats({
        total: entries.length,
        verified: entries.filter(e => e.isVerified).length,
        userCreated: userCreatedCount
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load whitelist" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addToWhitelist = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingEntry(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding encrypted entry with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const value = parseInt(newEntryData.value) || 1;
      const businessId = `whitelist-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, value);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEntryData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newEntryData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Entry added successfully!" });
      addUserHistory("Created", newEntryData.name);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadWhitelist();
      setShowAddModal(false);
      setNewEntryData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingEntry(false); 
    }
  };

  const decryptEntry = async (entryId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(entryId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(entryId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(entryId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadWhitelist();
      addUserHistory("Decrypted", entryId);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadWhitelist();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredWhitelist = whitelist.filter(entry => 
    entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Whitelist 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Wallet to Access Encrypted Whitelist</h2>
            <p>FHE technology ensures your whitelist data remains private while enabling verification</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted whitelist...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>FHE Whitelist Manager</h1>
          <p>Fully Homomorphic Encryption for Private Access Control</p>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Entries</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.userCreated}</div>
            <div className="stat-label">Your Entries</div>
          </div>
        </div>

        <div className="control-panel">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search whitelist entries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={checkAvailability} className="action-btn">Check Availability</button>
            <button onClick={() => setShowAddModal(true)} className="action-btn primary">+ Add Entry</button>
          </div>
        </div>

        <div className="content-grid">
          <div className="whitelist-section">
            <h2>Encrypted Whitelist Entries</h2>
            <div className="entries-list">
              {filteredWhitelist.map((entry, index) => (
                <div 
                  key={index}
                  className={`entry-card ${entry.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedEntry(entry)}
                >
                  <div className="entry-header">
                    <h3>{entry.name}</h3>
                    <span className={`status-badge ${entry.isVerified ? 'verified' : 'encrypted'}`}>
                      {entry.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <p className="entry-desc">{entry.description}</p>
                  <div className="entry-meta">
                    <span>Creator: {entry.creator.substring(0, 8)}...</span>
                    <span>Created: {new Date(entry.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  {entry.isVerified && (
                    <div className="decrypted-value">
                      Value: {entry.decryptedValue}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="side-panel">
            <div className="info-panel">
              <h3>FHE Technology</h3>
              <p>Fully Homomorphic Encryption allows computations on encrypted data without decryption</p>
              <div className="tech-steps">
                <div className="step">
                  <span>1</span>
                  <p>Data encrypted with FHE 🔐</p>
                </div>
                <div className="step">
                  <span>2</span>
                  <p>Stored encrypted on-chain</p>
                </div>
                <div className="step">
                  <span>3</span>
                  <p>Verified without revealing data</p>
                </div>
              </div>
            </div>

            <div className="history-panel">
              <h3>Your Activity</h3>
              <div className="history-list">
                {userHistory.map((item, index) => (
                  <div key={index} className="history-item">
                    <span className="action">{item.action}</span>
                    <span className="target">{item.target}</span>
                    <span className="time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Encrypted Entry</h2>
              <button onClick={() => setShowAddModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Entry Name</label>
                <input 
                  type="text"
                  value={newEntryData.name}
                  onChange={(e) => setNewEntryData({...newEntryData, name: e.target.value})}
                  placeholder="Enter entry name"
                />
              </div>
              <div className="form-group">
                <label>Encrypted Value (Integer)</label>
                <input 
                  type="number"
                  value={newEntryData.value}
                  onChange={(e) => setNewEntryData({...newEntryData, value: e.target.value})}
                  placeholder="Enter integer value"
                />
                <small>This value will be encrypted with FHE</small>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text"
                  value={newEntryData.description}
                  onChange={(e) => setNewEntryData({...newEntryData, description: e.target.value})}
                  placeholder="Enter description"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAddModal(false)}>Cancel</button>
              <button 
                onClick={addToWhitelist}
                disabled={addingEntry || isEncrypting}
                className="primary"
              >
                {addingEntry ? "Encrypting..." : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEntry && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Entry Details</h2>
              <button onClick={() => setSelectedEntry(null)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="detail-item">
                <label>Name:</label>
                <span>{selectedEntry.name}</span>
              </div>
              <div className="detail-item">
                <label>Description:</label>
                <span>{selectedEntry.description}</span>
              </div>
              <div className="detail-item">
                <label>Status:</label>
                <span className={selectedEntry.isVerified ? 'verified' : 'encrypted'}>
                  {selectedEntry.isVerified ? 'Verified' : 'Encrypted'}
                </span>
              </div>
              {selectedEntry.isVerified && (
                <div className="detail-item">
                  <label>Decrypted Value:</label>
                  <span>{selectedEntry.decryptedValue}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedEntry(null)}>Close</button>
              {!selectedEntry.isVerified && (
                <button 
                  onClick={() => decryptEntry(selectedEntry.id)}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt Entry"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

export default App;

