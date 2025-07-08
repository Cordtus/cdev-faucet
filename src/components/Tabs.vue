<template>
  <div>
    <ul class="nav nav-tabs" role="tablist">
      <li class="nav-item" role="presentation">
        <button 
          class="nav-link"
          :class="{ active: activeTab === 'network' }"
          @click="activeTab = 'network'"
          type="button"
          role="tab"
        >
          <i class="fas fa-network-wired me-2"></i>Network Info
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button 
          class="nav-link"
          :class="{ active: activeTab === 'faucet' }"
          @click="activeTab = 'faucet'"
          type="button"
          role="tab"
        >
          <i class="fas fa-faucet me-2"></i>Token Faucet
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button 
          class="nav-link"
          :class="{ active: activeTab === 'recent' }"
          @click="activeTab = 'recent'"
          type="button"
          role="tab"
        >
          <i class="fas fa-history me-2"></i>Recent Txs
          <span v-if="recentTransactions.length" class="badge bg-primary ms-1">
            {{ recentTransactions.length }}
          </span>
        </button>
      </li>
    </ul>
    
    <div class="tab-content">
      <NetworkInfo v-if="activeTab === 'network'" />
      <FaucetTab v-if="activeTab === 'faucet'" />
      <RecentTransactionsTab v-if="activeTab === 'recent'" />
    </div>
  </div>
</template>

<script setup>
import { ref, defineAsyncComponent } from 'vue'
import { useTransactions } from '../composables/useTransactions'

// Lazy load tab components for better code splitting
const NetworkInfo = defineAsyncComponent(() => import('./tabs/NetworkInfo.vue'))
const FaucetTab = defineAsyncComponent(() => import('./tabs/FaucetTab.vue'))
const RecentTransactionsTab = defineAsyncComponent(() => import('./tabs/RecentTransactionsTab.vue'))

const activeTab = ref('faucet')
const { recentTransactions } = useTransactions()
</script>