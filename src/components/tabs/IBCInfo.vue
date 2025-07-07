<template>
  <div class="ibc-info-container">
    <div class="ibc-header">
      <h6 class="section-title">
        <i class="fas fa-route"></i>
        IBC Token Registry
      </h6>
      <button 
        class="btn btn-sm btn-outline-primary" 
        @click="refreshIBCInfo" 
        :disabled="loading"
      >
        <i class="fas" :class="loading ? 'fa-spinner fa-spin' : 'fa-sync'"></i>
        Refresh
      </button>
    </div>

    <div v-if="loading && ibcTokens.length === 0" class="loading-state">
      <i class="fas fa-spinner fa-spin"></i>
      Loading IBC token information...
    </div>

    <div v-else-if="error" class="error-state">
      <i class="fas fa-exclamation-triangle"></i>
      {{ error }}
    </div>

    <div v-else-if="ibcTokens.length === 0" class="empty-state">
      <i class="fas fa-info-circle"></i>
      No IBC tokens found
    </div>

    <div v-else class="ibc-tokens-grid">
      <div 
        v-for="(token, index) in ibcTokens" 
        :key="token.denom"
        class="ibc-token-card"
        :class="{ 'expanded': expandedCards[index] }"
      >
        <div class="token-header" @click="toggleCard(index)">
          <div class="token-identity">
            <span class="token-symbol">{{ token.symbol }}</span>
            <span class="token-name">{{ token.name }}</span>
          </div>
          <i class="fas fa-chevron-down expand-icon" :class="{ 'rotated': expandedCards[index] }"></i>
        </div>

        <div class="token-details" v-show="expandedCards[index]">
          <div class="detail-item">
            <span class="detail-label">Base Denom:</span>
            <code class="detail-value" @click="copyToClipboard(token.baseDenom)">
              {{ token.baseDenom }}
              <i class="fas fa-copy copy-icon"></i>
            </code>
          </div>

          <div class="detail-item">
            <span class="detail-label">IBC Denom:</span>
            <code class="detail-value" @click="copyToClipboard(token.denom)">
              {{ formatIBCDenom(token.denom) }}
              <i class="fas fa-copy copy-icon"></i>
            </code>
          </div>

          <div v-if="token.path" class="detail-item">
            <span class="detail-label">IBC Path:</span>
            <span class="detail-value path-value">{{ token.path }}</span>
          </div>

          <div v-if="token.channels && token.channels.length" class="detail-item">
            <span class="detail-label">Channels:</span>
            <div class="channels-flow">
              <span 
                v-for="(channel, idx) in token.channels" 
                :key="idx"
                class="channel-badge"
              >
                {{ channel }}
                <i v-if="idx < token.channels.length - 1" class="fas fa-arrow-right channel-arrow"></i>
              </span>
            </div>
          </div>

          <div v-if="token.sourceChain" class="detail-item">
            <span class="detail-label">Source Chain:</span>
            <span class="detail-value chain-name">{{ token.sourceChain }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useConfig } from '../../composables/useConfig'

const { networkConfig, config } = useConfig()
const ibcTokens = ref([])
const loading = ref(false)
const error = ref('')
const expandedCards = ref({})

const formatIBCDenom = (denom) => {
  if (!denom) return ''
  const parts = denom.split('/')
  if (parts.length === 2 && parts[1].length > 8) {
    return `${parts[0]}/...${parts[1].slice(-6)}`
  }
  return denom
}

const formatBalance = (amount, decimals = 6) => {
  if (!amount || amount === '0') return '0'
  
  try {
    const divisor = Math.pow(10, decimals)
    const value = parseFloat(amount) / divisor
    
    if (value === 0) return '0'
    if (value < 0.000001) return value.toExponential(2)
    if (value < 1) return value.toFixed(6).replace(/\.?0+$/, '')
    if (value < 1000) return value.toFixed(2).replace(/\.?0+$/, '')
    
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  } catch (error) {
    console.error('Error formatting balance:', error)
    return '0'
  }
}

const copyToClipboard = async (text) => {
  if (!text) return
  
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const toggleCard = (index) => {
  expandedCards.value[index] = !expandedCards.value[index]
}

const queryDenomTrace = async (hash, restEndpoint) => {
  try {
    const response = await fetch(`${restEndpoint}/ibc/apps/transfer/v1/denoms/${hash}`)
    if (!response.ok) return null
    
    const data = await response.json()
    return data.denom
  } catch (error) {
    console.error(`Failed to query denom trace for ${hash}:`, error)
    return null
  }
}

const queryDenomMetadata = async (denom, restEndpoint) => {
  try {
    const response = await fetch(`${restEndpoint}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`)
    if (!response.ok) return null
    
    const data = await response.json()
    return data.metadata
  } catch (error) {
    return null
  }
}

const fetchIBCTokenInfo = async () => {
  loading.value = true
  error.value = ''
  
  try {
    const restEndpoint = networkConfig.value.cosmos?.rest || config.value?.blockchain?.endpoints?.rest_endpoint
    const cosmosAddress = networkConfig.value.faucetAddresses?.cosmos
    
    if (!restEndpoint || !cosmosAddress) {
      console.log('Missing required config:', { restEndpoint, cosmosAddress })
      error.value = 'Configuration not loaded yet'
      return
    }
    
    // Fetch all balances
    console.log('Fetching IBC tokens from:', `${restEndpoint}/cosmos/bank/v1beta1/balances/${cosmosAddress}`)
    const balancesResponse = await fetch(`${restEndpoint}/cosmos/bank/v1beta1/balances/${cosmosAddress}`)
    
    if (!balancesResponse.ok) {
      console.error('Failed to fetch balances:', balancesResponse.status, balancesResponse.statusText)
      throw new Error(`Failed to fetch balances: ${balancesResponse.status}`)
    }
    
    const balancesData = await balancesResponse.json()
    console.log('Balances response:', balancesData)
    
    if (!balancesData.balances || !Array.isArray(balancesData.balances)) {
      throw new Error('Failed to fetch balances')
    }
    
    // Filter IBC tokens (case-insensitive)
    const ibcBalances = balancesData.balances.filter(b => b.denom.toLowerCase().startsWith('ibc/'))
    
    // Get token info from config
    const nativeTokens = config.value?.nativeTokens || []
    
    // Fetch detailed info for each IBC token
    const tokenPromises = ibcBalances.map(async (balance) => {
      const denomLower = balance.denom.toLowerCase()
      
      // Find matching token config
      const tokenConfig = nativeTokens.find(t => 
        t.denom && t.denom.toLowerCase() === denomLower
      )
      
      if (tokenConfig) {
        // Use info from config
        return {
          denom: balance.denom,
          baseDenom: tokenConfig.symbol?.toLowerCase() || 'unknown',
          name: tokenConfig.name || 'Unknown Token',
          symbol: tokenConfig.symbol || 'UNKNOWN',
          decimals: tokenConfig.decimals || 6,
          balance: balance.amount,
          path: tokenConfig.description || '',
          channels: tokenConfig.description?.match(/channel-\d+/gi) || [],
          sourceChain: tokenConfig.description?.includes('Osmosis') ? 'Osmosis' : 
                       tokenConfig.description?.includes('channel') ? 'IBC Chain' : 'Unknown',
          hash: balance.denom.replace(/ibc\//i, '')
        }
      } else {
        // Fallback for unknown IBC tokens
        const hash = balance.denom.replace(/ibc\//i, '')
        
        // Try to query denom trace (might fail)
        const trace = await queryDenomTrace(hash, restEndpoint)
        
        if (trace) {
          const baseDenom = trace.base || 'unknown'
          const channels = trace.trace?.map(t => t.channel_id) || []
          const symbol = baseDenom.startsWith('u') ? baseDenom.substring(1).toUpperCase() : baseDenom.toUpperCase()
          
          return {
            denom: balance.denom,
            baseDenom: baseDenom,
            name: symbol,
            symbol: symbol,
            decimals: 6,
            balance: balance.amount,
            path: channels.length > 0 ? `transfer/${channels.join('/transfer/')}` : '',
            channels: channels,
            sourceChain: symbol === 'OSMO' ? 'Osmosis' : 'IBC Chain',
            hash
          }
        } else {
          // Complete fallback
          return {
            denom: balance.denom,
            baseDenom: 'unknown',
            name: 'Unknown IBC Token',
            symbol: 'IBC',
            decimals: 6,
            balance: balance.amount,
            path: '',
            channels: [],
            sourceChain: 'Unknown',
            hash
          }
        }
      }
    })
    
    const results = await Promise.all(tokenPromises)
    ibcTokens.value = results.filter(t => t !== null)
    
    // Initialize all cards as collapsed
    expandedCards.value = {}
    ibcTokens.value.forEach((_, index) => {
      expandedCards.value[index] = false
    })
    
  } catch (err) {
    console.error('Error fetching IBC token info:', err)
    error.value = 'Failed to load IBC token information'
  } finally {
    loading.value = false
  }
}

const refreshIBCInfo = () => {
  fetchIBCTokenInfo()
}

onMounted(async () => {
  console.log('IBCInfo mounted')
  console.log('networkConfig:', networkConfig.value)
  console.log('config:', config.value)
  
  // Wait a bit for config to be loaded
  if (!networkConfig.value.faucetAddresses?.cosmos) {
    console.log('Waiting for config to load...')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('Fetching IBC token info...')
  fetchIBCTokenInfo()
})
</script>

<style scoped>
.ibc-info-container {
  padding: 0;
}

.ibc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-title {
  color: var(--cosmos-accent);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.error-state {
  color: var(--error-color, #ff6b6b);
}

.ibc-tokens-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
}

.ibc-token-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.25rem;
  transition: all 0.2s ease;
}

.ibc-token-card:hover {
  border-color: var(--cosmos-accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.token-header:hover {
  color: var(--cosmos-accent);
}

.token-identity {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.token-symbol {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.token-name {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.expand-icon {
  font-size: 0.9rem;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.token-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.detail-value {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.85rem;
  color: var(--text-primary);
  word-break: break-all;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: color 0.2s ease;
}

.detail-value:hover {
  color: var(--cosmos-accent);
}

.copy-icon {
  font-size: 0.75rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.detail-value:hover .copy-icon {
  opacity: 0.7;
}

.path-value {
  font-size: 0.8rem;
  color: var(--text-primary);
}

.channels-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.25rem;
}

.channel-badge {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  font-family: monospace;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.channel-arrow {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.chain-name {
  color: var(--cosmos-accent);
  font-weight: 500;
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .ibc-tokens-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  
  .ibc-header {
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }
  
  .section-title {
    font-size: 1rem;
  }
  
  .ibc-token-card {
    padding: 1rem;
  }
  
  .token-header {
    padding: 0.75rem 0;
  }
  
  .token-symbol {
    font-size: 1rem;
  }
  
  .detail-value {
    font-size: 0.75rem;
  }
  
  .channels-flow {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>