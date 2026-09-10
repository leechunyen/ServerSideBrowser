// --- 設定區 ---
const CONFIG = {
  PORT: parseInt(process.env.PORT, 10) || 9300, // 服務運行的端口
  RENDER_PATH: process.env.RENDER_PATH || '/render', // 提供渲染服務的路徑
  USER_AGENT: process.env.USER_AGENT || 'server_side_browser', // 爬取時使用的 User-Agent
  CACHE_TTL: parseInt(process.env.CACHE_TTL, 10) || 30 * 60 * 1000, // 快取存活時間（30分鐘）
  MAX_CACHE_ITEMS: parseInt(process.env.MAX_CACHE_ITEMS, 10) || 1000, // 快取最大數量限制
  MAX_CONCURRENT_PAGES: parseInt(process.env.MAX_CONCURRENT_PAGES, 10) || 5, // 最大並發渲染數量
  MAX_RENDER_PER_BROWSER: parseInt(process.env.MAX_RENDER_PER_BROWSER, 10) || 500, // [穩定性] 每渲染 N 次自動重啟瀏覽器以釋放記憶體
  SKIP_STATIC_RESOURCES: { // 是否跳過載入靜態資源
    images: true, // 圖片
    fonts: true,  // 字體
    media: true,  // 影片、音訊
  },
};
// --- 設定區結束 ---

// 引入 Express 框架，用於建立網頁伺服器
const express = require('express');
// 引入 Puppeteer 函式庫，用於控制無頭 Chrome 瀏覽器
const puppeteer = require('puppeteer');
// 引入 LRUCache 函式庫，用於管理記憶體快取
const { LRUCache } = require('lru-cache');

// 建立 Express 應用程式實例
const app = express();
// 使用 Express 的中介軟體，以解析傳入的 JSON 格式請求體
app.use(express.json());

// 建立 LRU 快取實例
const cache = new LRUCache({
  max: CONFIG.MAX_CACHE_ITEMS,
  ttl: CONFIG.CACHE_TTL,
});

// 全局狀態變數
let browser;
let activeRequests = 0; // 追蹤目前處理中的請求數量
let renderCount = 0; // 追蹤目前瀏覽器實例已渲染的次數
let isInitializing = false; // [防護] 狀態鎖：防止多重重啟重疊

/**
 * 初始化 Puppeteer，啟動一個共享的瀏覽器實例
 */
async function initializeBrowser() {
  // [防護] 防止並行初始化
  if (isInitializing) return;
  isInitializing = true;
  
  console.log('Initializing browser...');
  try {
    if (browser) {
      // 移除斷線監聽器，避免我們主動關閉時觸發無限迴圈
      browser.removeAllListeners('disconnected');
      await browser.close().catch(() => {});
    }
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu', // 停用 GPU 加速 (無頭模式不需要)
        '--disable-extensions', // 停用任何擴充套件
        '--blink-settings=imagesEnabled=false', // 引擎層級直接關閉圖片解析，極致加速
        '--disable-background-timer-throttling', // 避免 JS 計時器在背景被降速
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding' // 確保頁面全速渲染不受背景化影響
      ]
    });
    
    // 重置計數器
    renderCount = 0;
    console.log('Browser initialized successfully.');

    // 處理瀏覽器意外崩潰的情況
    browser.on('disconnected', () => {
      console.warn('Browser disconnected or crashed. Restarting...');
      initializeBrowser();
    });
  } catch (error) {
    console.error('Failed to initialize browser:', error);
    // 重試機制
    setTimeout(() => {
      isInitializing = false; // 解除鎖定讓 setTimeout 裡的重試可以執行
      initializeBrowser();
    }, 5000);
  } finally {
    isInitializing = false;
  }
}

/**
 * 處理所有指向渲染路徑的請求
 */
app.all(CONFIG.RENDER_PATH, async (req, res) => {
  // 並發限制檢查
  if (activeRequests >= CONFIG.MAX_CONCURRENT_PAGES) {
    console.warn(`Concurrency limit reached. Rejecting request.`);
    return res.status(429).send('Too Many Requests. Server is busy.');
  }

  // 從請求標頭中獲取目標網址 'x-url'
  const url = req.headers['x-url'];

  // Log the incoming request URL
  console.log(`Rendering request for URL: ${url}`);

  // 如果沒有提供 URL，回傳 400 錯誤
  if (!url) {
    return res.status(400).send('Missing url');
  }

  try {
    // 驗證 URL 格式及通訊協定 (防止 SSRF)
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).send('Only HTTP and HTTPS protocols are allowed');
    }
  } catch (e) {
    return res.status(400).send('Invalid URL format');
  }

  if (!browser || !browser.isConnected() || isInitializing) {
    return res.status(503).send('Browser is initializing or crashed. Please try again later.');
  }

  activeRequests++;
  renderCount++;
  let page;
  try {
    // 從共享的瀏覽器實例中開啟一個新的分頁
    page = await browser.newPage();

    // 設定自訂的 User-Agent，以便於日誌分析與識別
    await page.setUserAgent(CONFIG.USER_AGENT);

    // 啟用請求攔截功能
    await page.setRequestInterception(true);

    // 定義請求攔截事件處理器 (為了稍後可以 removeListener，這裡提出為獨立常數)
    const requestHandler = (request) => {
      // 確保操作前 Request 未被異常中斷
      if (request.isInterceptResolutionHandled()) return;
        
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // 阻擋不需要的連線類型以加速渲染
      const blockedResourceTypes = ['image', 'font', 'media', 'websocket', 'manifest', 'other'];
      if (blockedResourceTypes.includes(resourceType)) {
        request.abort().catch(() => {}); // 靜默攔截 abort 時的錯誤
        return;
      }

      // 阻擋常見的第三方追蹤與廣告腳本 (避免浪費時間等待 GA/FB 回應)
      const blockedDomains = [
        'google-analytics.com',
        'analytics.google.com',
        'googletagmanager.com',
        'connect.facebook.net',
        'facebook.com/tr',
        'hotjar.com',
        'doubleclick.net'
      ];
      if (blockedDomains.some(domain => requestUrl.includes(domain))) {
        request.abort().catch(() => {});
        return;
      }

      // 檢查請求是否為樣式表或腳本
      if (resourceType === 'stylesheet' || resourceType === 'script') {
        const cachedResource = cache.get(requestUrl);
        // 如果資源存在於快取中
        if (cachedResource) {
          console.log(`Serving from cache: ${requestUrl}`);
          // 直接從快取回應請求，中斷網路請求
          request.respond({
            status: 200,
            contentType: cachedResource.contentType,
            body: cachedResource.data
          }).catch(() => {});
          return;
        }
      }
      // 對於其他所有請求，繼續執行
      request.continue().catch(() => {});
    };

    // 定義回應事件處理器
    const responseHandler = async (response) => {
      const requestUrl = response.url();
      const request = response.request();
      const resourceType = request.resourceType();
      
      // 確保只快取 200 OK 的樣式表或腳本
      if (response.status() === 200 && (resourceType === 'stylesheet' || resourceType === 'script')) {
        const headers = response.headers();
        const cacheControl = headers['cache-control'] || '';
        
        // 檢查伺服器是否標示不應快取 (no-store 或 no-cache)
        if (cacheControl.toLowerCase().includes('no-store') || cacheControl.toLowerCase().includes('no-cache')) {
          console.log(`Skipping cache for ${requestUrl} due to Cache-Control header`);
          return;
        }

        try {
          // [記憶體洩漏防護] 讀取 text() 前，先確認頁面沒有被關閉
          if (page.isClosed()) return;
            
          const resourceContent = await response.text();
          // 存入 LRU 快取
          cache.set(requestUrl, { 
            data: resourceContent, 
            contentType: headers['content-type'] 
          });
        } catch(e) {
            // 忽略協議錯誤或 Target 關閉錯誤，這在 page 突然被關閉時很常見
            if (!e.message.includes('Protocol error') && !e.message.includes('Target closed')) {
                console.error(`Failed to cache response for: ${requestUrl}, Error: ${e.message}`);
            }
        }
      }
    };

    // 綁定事件監聽器
    page.on('request', requestHandler);
    page.on('response', responseHandler);

    // 導航到目標 URL，等待直到網路空閒（表示頁面主要資源已載入完畢）
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    // 獲取頁面渲染後的完整 HTML 內容
    const html = await page.content();

    // 回傳 200 成功狀態碼及渲染後的 HTML
    res.status(200).send(html);

  } catch (error) {
    console.error(`Error during rendering process: ${error}`);
    // 不要洩漏內部錯誤給客戶端，給出一般性錯誤
    if (!res.headersSent) {
      res.status(500).send('Rendering failed');
    }
  } finally {
    // 無論成功或失敗，最後都確保關閉分頁以釋放資源
    if (page && !page.isClosed()) {
      // [記憶體洩漏防護] 關閉前徹底清除閉包綁定的 Event Listeners，防止記憶體殘留
      page.removeAllListeners('request');
      page.removeAllListeners('response');
      await page.close().catch(e => console.error('Error closing page', e));
    }
    activeRequests--;

    // [修正死鎖] 當目前無活動請求，且總渲染次數已達上限，才在背景發起重啟
    if (activeRequests === 0 && renderCount >= CONFIG.MAX_RENDER_PER_BROWSER && !isInitializing) {
      console.log(`Browser reached render limit (${CONFIG.MAX_RENDER_PER_BROWSER}). Triggering automated background restart to free memory.`);
      // 不使用 await，讓其在背景非同步執行，完全不阻擋當前請求生命週期的結束
      initializeBrowser().catch(e => console.error('Background restart failed', e));
    }
  }
});

/**
 * 啟動整個服務
 */
async function startServer() {
  // 必須先初始化瀏覽器
  await initializeBrowser();
  // 啟動 Express 伺服器並監聽指定端口
  const server = app.listen(CONFIG.PORT, () => {
    console.log(`Server-side rendering service is running on http://localhost:${CONFIG.PORT}`);
  });
  return server;
}

// 執行服務啟動程序
startServer().then((server) => {
    /**
     * 定義一個優雅的關閉函數，用於處理進程退出信號
     * @param {string} signal - 接收到的信號名稱
     */
    const gracefulShutdown = async (signal) => {
        console.log(`\nReceived signal ${signal}, shutting down gracefully...`);
        // 如果瀏覽器實例存在，則關閉它
        if (browser) {
            console.log('Closing browser...');
            // 移除 disconnected 監聽器，避免關閉時觸發重啟
            browser.removeAllListeners('disconnected');
            await browser.close().catch(() => {});
        }
        // 關閉 Express 伺服器
        server.close(() => {
            console.log('Server closed.');
            process.exit(0); // 正常退出進程
        });
    };

    // 監聽 'SIGINT' 信號（例如，按下 Ctrl+C）
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    // 監聽 'SIGTERM' 信號（例如，由 Docker 或系統發出的終止命令）
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
});