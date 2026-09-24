import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true // เปิดให้มือถือใน Wi-Fi เดียวกันสแกนสตรีมเข้าหา IP เครื่องนี้ได้
  }
})