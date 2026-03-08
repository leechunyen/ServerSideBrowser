// 引入 Express 框架，用於建立網頁伺服器
const express = require('express');
// 引入 Puppeteer 函式庫，用於控制無頭 Chrome 瀏覽器
const puppeteer = require('puppeteer');

// --- 設定區 ---
const CONFIG = {
  PORT: 9300, // 服務運行的端口
  RENDER_PATH: '/render', // 提供渲染服務的路徑
  USER_AGENT: 'server-side-browser', // 爬取時使用的 User-Agent
  CACHE_TTL: 30 * 60 * 1000, // 快取存活時間（30分鐘）
  SKIP_STATIC_RESOURCES: { // 是否跳過載入靜態資源
    images: true, // 圖片
    fonts: true,  // 字體
    media: true,  // 影片、音訊
  },
};
// --- 設定區結束 ---

// 建立 Express 應用程式實例
const app = express();
// 使用 Express 的中介軟體，以解析傳入的 JSON 格式請求體
app.use(express.json());

// 建立一個簡單的記憶體快取物件，用於儲存 CSS 和 JS 檔案
const cache = {};
// 宣告一個變數，用於儲存共享的 Puppeteer 瀏覽器實例
let browser;

/**
 * 清理過期的快取項目
 */
function cleanUpCache() {
  const now = Date.now();
  for (const key in cache) {
    // 檢查屬性是否為物件自身擁有，且快取是否已過期
    if (cache.hasOwnProperty(key) && (now - cache[key].timestamp >= CONFIG.CACHE_TTL)) {
      console.log(`Removing expired cache for: ${key}`);
      delete cache[key];
    }
  }
}

/**
 * 初始化 Puppeteer，啟動一個共享的瀏覽器實例
 */
async function initializeBrowser() {
  console.log('Initializing browser...');
  browser = await puppeteer.launch({
    args: [
      '--no-sandbox', // 在容器環境中，停用沙箱模式
      '--disable-setuid-sandbox', // 禁用 setuid 沙箱（主要用於 Linux）
      '--disable-dev-shm-usage' // 解決在 Docker 容器中 /dev/shm 共享記憶體不足的問題
    ]
  });
  console.log('Browser initialized successfully.');
}

/**
 * 處理所有指向渲染路徑的請求
 */
app.all(CONFIG.RENDER_PATH, async (req, res) => {
  // 從請求標頭中獲取目標網址 'x-url'
  const url = req.headers['x-url'];

// Log the incoming request URL
  console.log(`Rendering request for URL: ${url}`);

  // 如果沒有提供 URL，回傳 400 錯誤
  if (!url) {
    return res.status(400).send('Missing url');
  }

  try {
    // 使用 new URL() 建構子來驗證 URL，更為可靠
    new URL(url);
  } catch (e) {
    // 如果 URL 格式不正確，建構子會拋出錯誤
    return res.status(400).send('Invalid URL format');
  }

  let page;
  try {
    // 從共享的瀏覽器實例中開啟一個新的分頁
    page = await browser.newPage();

    // 設定自訂的 User-Agent，以便於日誌分析與識別
    await page.setUserAgent(CONFIG.USER_AGENT);

    // 啟用請求攔截功能
    await page.setRequestInterception(true);

    // 設定請求攔截事件監聽器
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // 根據設定，阻擋載入圖片、字體和多媒體檔案以加速渲染
      if (
        (CONFIG.SKIP_STATIC_RESOURCES.images && resourceType === 'image') ||
        (CONFIG.SKIP_STATIC_RESOURCES.fonts && resourceType === 'font') ||
        (CONFIG.SKIP_STATIC_RESOURCES.media && resourceType === 'media')
      ) {
        request.abort();
        return;
      }

      // 檢查請求是否為樣式表或腳本
      if (resourceType === 'stylesheet' || resourceType === 'script') {
        const cachedResource = cache[requestUrl];
        // 如果資源存在於快取中且尚未過期
        if (cachedResource && (Date.now() - cachedResource.timestamp < CONFIG.CACHE_TTL)) {
          console.log(`Serving from cache: ${requestUrl}`);
          // 直接從快取回應請求，中斷網路請求
          request.respond({
            status: 200,
            contentType: cachedResource.contentType, // 使用快取的 Content-Type
            body: cachedResource.data
          });
          return;
        }
      }
      // 對於其他所有請求，繼續執行
      request.continue();
    });

    // 設定回應事件監聽器，用於快取新的資源
    page.on('response', async (response) => {
      const requestUrl = response.url();
      const resourceType = response.request().resourceType();

      // 如果資源是樣式表或腳本
      if (resourceType === 'stylesheet' || resourceType === 'script') {
        try {
          const resourceContent = await response.text();
          // 儲存內容時，同時存入 Content-Type 標頭
          cache[requestUrl] = { 
            data: resourceContent, 
            timestamp: Date.now(),
            contentType: response.headers()['content-type'] // 取得原始的 Content-Type
          };
        } catch(e) {
            console.error(`Failed to cache response for: ${requestUrl}, Error: ${e.message}`);
        }
      }
    });

    // 導航到目標 URL，等待直到網路空閒（表示頁面主要資源已載入完畢）
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    // 獲取頁面渲染後的完整 HTML 內容
    const html = await page.content();

    // 回傳 200 成功狀態碼及渲染後的 HTML
    res.status(200).send(html);

  } catch (error) {
    console.error(`Error during rendering process: ${error}`);
    res.status(500).send('Rendering failed');
  } finally {
    // 無論成功或失敗，最後都確保關閉分頁以釋放資源
    if (page) {
      await page.close();
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
    // 設定一個定時器，每 5 分鐘執行一次快取清理任務
    setInterval(cleanUpCache, 5 * 60 * 1000);
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
            await browser.close();
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