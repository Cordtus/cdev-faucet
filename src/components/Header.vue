<template>
  <div class="header">
    <div class="container">
      <div class="d-flex justify-content-between align-items-center">
        <div class="brand-container">
          <h1 class="brand-logo">cosmos-evm</h1>
          <span class="brand-subtitle">DEVNET-1</span>
        </div>
        <nav class="nav-icons">
          <a
            href="https://cosmos-docs.mintlify.app/docs"
            target="_blank"
            class="nav-link"
            title="Documentation"
          >
            <span class="icon-wrapper">
              <svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 6h8M8 10h8M8 14h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="nav-text">docs</span>
            </span>
          </a>
          <a
            href="https://cosmos.network"
            target="_blank"
            class="nav-link"
            title="Network"
          >
            <span class="icon-wrapper">
              <svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
              </svg>
              <span class="nav-text">network</span>
            </span>
          </a>
          <a
            href="https://discord.gg/interchain"
            target="_blank"
            class="nav-link"
            title="Discord"
          >
            <span class="icon-wrapper">
              <svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" stroke="currentColor" stroke-width="0.5" fill="currentColor"/>
              </svg>
              <span class="nav-text">discord</span>
            </span>
          </a>
          <a
            href="https://github.com/cosmos/evm"
            target="_blank"
            class="nav-link"
            title="GitHub"
          >
            <span class="icon-wrapper">
              <svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              </svg>
              <span class="nav-text">github</span>
            </span>
          </a>
        </nav>
      </div>
      <div class="version-badge">v{{ version }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useConfig } from '../composables/useConfig'

const { config } = useConfig()
const projectName = computed(() => config.value?.project?.name || 'Cosmos EVM Faucet')
// Version will be updated with each deployment
const version = '1.1.5'
</script>

<style scoped>
.header {
  padding: 1.5rem 0;
}

.header .container {
  position: relative;
}

.brand-container {
  position: relative;
  margin-left: -1rem;
}

.brand-logo {
  font-family: 'Bungee', cursive;
  font-size: 3.5rem;
  font-weight: 400;
  margin: 0;
  letter-spacing: 0.02em;
  color: var(--cosmos-accent);
  text-transform: lowercase;
  line-height: 0.7;
  transform: scaleY(0.7);
  transform-origin: left center;
}

.brand-subtitle {
  position: absolute;
  bottom: -0.5rem;
  right: -1rem;
  font-family: 'Bungee', cursive;
  font-size: 0.9rem;
  font-weight: 400;
  color: #00ff88;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.version-badge {
  position: absolute;
  bottom: -1.2rem;
  right: 0;
  font-family: monospace;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}

.nav-icons {
  display: flex;
  gap: 2rem;
  align-items: flex-end;
  margin-right: -1rem;
  padding-bottom: 0.5rem;
}

.nav-link {
  text-decoration: none;
  color: var(--text-primary);
  transition: color 0.3s ease;
  position: relative;
  z-index: 10;
}

.nav-link:hover {
  color: var(--cosmos-accent);
  z-index: 20;
}

.icon-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  overflow: visible;
}

.nav-icon {
  width: 24px;
  height: 24px;
  transition: all 0.3s ease;
  position: absolute;
}

.nav-text {
  position: absolute;
  opacity: 0;
  font-family: 'Bungee', cursive;
  font-size: 1rem;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.nav-link:hover .nav-icon {
  opacity: 0;
  transform: scale(0.8);
}

.nav-link:hover .nav-text {
  opacity: 1;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .header {
    padding: 1rem 0;
  }

  .brand-container {
    margin-left: 0;
  }

  .brand-logo {
    font-size: 2rem;
  }

  .brand-subtitle {
    font-size: 0.6rem;
    bottom: -0.2rem;
    right: -0.3rem;
  }

  .version-badge {
    font-size: 0.6rem;
    padding: 0.1rem 0.3rem;
    bottom: -1rem;
  }

  .nav-icons {
    gap: 1rem;
    margin-right: 0;
    padding-bottom: 0.2rem;
  }

  .icon-wrapper {
    width: 1.8rem;
    height: 1.8rem;
  }

  .nav-icon {
    width: 18px;
    height: 18px;
  }

  .nav-text {
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .brand-logo {
    font-size: 1.5rem;
  }

  .nav-icons {
    gap: 0.75rem;
  }

  .icon-wrapper {
    width: 1.5rem;
    height: 1.5rem;
  }

  .nav-icon {
    width: 16px;
    height: 16px;
  }
}
</style>