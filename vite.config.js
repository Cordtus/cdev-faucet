import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  json: {
    stringify: true
  },
  optimizeDeps: {
    include: ['@reown/appkit', '@reown/appkit-adapter-wagmi', '@wagmi/vue'],
    exclude: []
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          'vendor': [
            'vue',
            '@vue/runtime-dom',
            '@vue/runtime-core',
            '@vue/shared',
            '@vue/reactivity'
          ],
          'wallet': [
            '@reown/appkit',
            '@reown/appkit-adapter-wagmi',
            '@wagmi/vue',
            '@wagmi/core',
            'viem'
          ],
          'cosmjs': [
            '@cosmjs/stargate',
            '@cosmjs/proto-signing',
            '@cosmjs/crypto',
            '@cosmjs/encoding'
          ],
          'ethers': [
            'ethers'
          ]
        }
      }
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['faucet.basementnodes.ca', 'localhost'],
    proxy: {
      '/send': 'http://localhost:8088',
      '/config.json': 'http://localhost:8088',
      '/balance': 'http://localhost:8088',
      '/transaction': 'http://localhost:8088'
    }
  }
})