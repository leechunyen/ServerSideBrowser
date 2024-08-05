# 使用 Node.js 官方镜像作为基础镜像
FROM node:18

# 安装必要的系统依赖项，包括 Puppeteer 所需的依赖项
RUN apt-get update && apt-get install -y \
  gconf-service \
  libasound2 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  libdrm2 \
  libgbm1 \
  ca-certificates \
  fonts-liberation \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget \
  --no-install-recommends && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果有）
COPY package*.json ./

# 安装项目依赖
RUN npm install

# 安装 Puppeteer 并设置 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD 环境变量
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
RUN npm install puppeteer

# 复制项目文件到工作目录
COPY . .

# 暴露应用程序的端口
EXPOSE 9300

# 启动应用程序
CMD ["node", "./index.js"]