# 1. 選擇適合的 Base Image (使用輕量級的 slim 版本)
FROM node:20-slim

# 2. 安裝 Chromium、必要字型及 dumb-init
# 透過安裝 'chromium' 套件，apt 會自動幫我們補齊底層需要的 libnss3, libgbm 等依賴庫
# 同時安裝多國語言字型避免網頁渲染時出現亂碼方塊 (豆腐字)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. 設定環境變數：跳過 Puppeteer 自帶的 Chrome 下載，改用我們剛剛安裝的系統 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4. 建立工作目錄，並將擁有者改為內建的非 root 使用者 'node'
WORKDIR /app
RUN chown -R node:node /app

# 5. [安全性修正] 切換至非 root 使用者 'node'
USER node

# 6. 複製依賴檔案 (注意加上 --chown=node:node)
COPY --chown=node:node package*.json ./

# 7. 安裝專案依賴 (只安裝 production 依賴)
RUN npm install --omit=dev

# 8. 複製原始碼
COPY --chown=node:node . .

EXPOSE 9300

# 9. 使用 dumb-init 作為 PID 1 啟動 Node.js，防止僵屍進程 (Zombie Processes)
CMD ["dumb-init", "--", "node", "index.js"]