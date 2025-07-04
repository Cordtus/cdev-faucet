<template>
  <div>
    <!-- Network Details -->
    <div class="info-card">
      <h5 class="info-title">
        <i class="fas fa-network-wired"></i>
        Network Details
      </h5>
      
      <!-- Nested Tab Navigation -->
      <ul class="nav nav-pills mb-3" role="tablist">
        <li class="nav-item" role="presentation">
          <button 
            class="nav-link"
            :class="{ active: activeNetworkTab === 'cosmos' }"
            @click="activeNetworkTab = 'cosmos'"
            type="button"
            role="tab"
          >
            <i class="fas fa-atom me-2"></i>Cosmos
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button 
            class="nav-link"
            :class="{ active: activeNetworkTab === 'evm' }"
            @click="activeNetworkTab = 'evm'"
            type="button"
            role="tab"
          >
            <i class="fab fa-ethereum me-2"></i>EVM
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button 
            class="nav-link"
            :class="{ active: activeNetworkTab === 'ibc' }"
            @click="activeNetworkTab = 'ibc'"
            type="button"
            role="tab"
          >
            <i class="fas fa-route me-2"></i>IBC
          </button>
        </li>
      </ul>

      <!-- Tab Content -->
      <div class="tab-content">
        <!-- Cosmos Section -->
        <div v-if="activeNetworkTab === 'cosmos'" class="network-section">
          <div class="info-item">
            <span class="info-label">Chain ID:</span>
            <code class="info-value">{{ networkConfig.cosmos?.chainId || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">RPC:</span>
            <code class="info-value text-truncate">{{ networkConfig.cosmos?.rpc || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">gRPC:</span>
            <code class="info-value text-truncate">{{ networkConfig.cosmos?.grpc || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">REST:</span>
            <code class="info-value text-truncate">{{ networkConfig.cosmos?.rest || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">Faucet Wallet:</span>
            <code class="info-value address-value" @click="copyToClipboard(networkConfig.faucetAddresses?.cosmos)">
              {{ networkConfig.faucetAddresses?.cosmos || 'Loading...' }}
              <i class="fas fa-copy copy-icon"></i>
            </code>
          </div>
        </div>

        <!-- EVM Section -->
        <div v-if="activeNetworkTab === 'evm'" class="network-section">
          <div class="info-item">
            <span class="info-label">Chain ID:</span>
            <code class="info-value">{{ networkConfig.evm?.chainId || 'Loading...' }} ({{ networkConfig.evm?.chainIdHex || '0x...' }})</code>
          </div>
          <div class="info-item">
            <span class="info-label">RPC:</span>
            <code class="info-value text-truncate">{{ networkConfig.evm?.rpc || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">WebSocket:</span>
            <code class="info-value text-truncate">{{ networkConfig.evm?.websocket || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">Explorer:</span>
            <code class="info-value text-truncate">{{ networkConfig.evm?.explorer || 'Loading...' }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">Faucet Wallet:</span>
            <code class="info-value address-value" @click="copyToClipboard(networkConfig.faucetAddresses?.evm)">
              {{ networkConfig.faucetAddresses?.evm || 'Loading...' }}
              <i class="fas fa-copy copy-icon"></i>
            </code>
          </div>
        </div>

        <!-- IBC Section -->
        <div v-if="activeNetworkTab === 'ibc'" class="network-section">
          <IBCInfo />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useConfig } from '../../composables/useConfig'
import IBCInfo from './IBCInfo.vue'

const { networkConfig, config } = useConfig()
const copiedText = ref('')
const activeNetworkTab = ref('cosmos')

const formatAddress = (address) => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const copyToClipboard = async (text) => {
  if (!text) return
  
  try {
    await navigator.clipboard.writeText(text)
    copiedText.value = text
    setTimeout(() => {
      copiedText.value = ''
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

</script>

<style scoped>
/* Tab Navigation Styles */
.nav-pills {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0;
}

.nav-pills .nav-link {
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 8px 8px 0 0;
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  transition: all 0.2s ease;
  border-bottom: 2px solid transparent;
}

.nav-pills .nav-link:hover {
  color: var(--cosmos-accent);
  background: var(--bg-secondary);
}

.nav-pills .nav-link.active {
  color: var(--cosmos-accent);
  background: var(--bg-secondary);
  border-bottom-color: var(--cosmos-accent);
}

.tab-content {
  padding-top: 1rem;
}

@media (max-width: 768px) {
  .nav-pills {
    margin-bottom: 1rem;
  }
  
  .nav-pills .nav-link {
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
  }
  
  .info-card {
    padding: 1rem;
  }
  
  .info-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .info-label {
    min-width: auto;
    font-size: 0.85rem;
  }
  
  .info-value {
    font-size: 0.8rem;
    width: 100%;
  }
  
  /* Allow text wrapping on mobile */
  .text-truncate {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    word-break: break-word;
  }
  
  .address-value {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
  }
  
  .section-subtitle {
    font-size: 0.9rem;
  }
}

.info-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
}

.info-title {
  color: var(--cosmos-accent);
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 0.75rem;
  gap: 0.5rem;
}

.info-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
  min-width: 120px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.85rem;
  word-break: break-word;
  flex: 1;
  min-width: 0;
}

.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  display: block;
}

.address-value {
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.address-value:hover {
  color: var(--cosmos-accent);
}

.copy-icon {
  font-size: 0.75rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.address-value:hover .copy-icon {
  opacity: 0.7;
}


.section-subtitle {
  color: var(--cosmos-accent);
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
}

.network-section {
  padding: 0;
}

</style>