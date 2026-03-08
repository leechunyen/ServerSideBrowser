const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const port = 9300; // 渲染服务的端口

// 解析 JSON 请求体
app.use(express.json());

const cache = {}; // 用来缓存 CSS 和 JS 相关的静态资源
const CACHE_TTL = 30 * 60 * 1000; // 缓存有效时间（30分钟）

let browser; // 持久化的浏览器实例

// 清理过期缓存的函数
function cleanUpCache() {
  const now = Date.now();
  for (const key in cache) {
    if (cache.hasOwnProperty(key) && (now - cache[key].timestamp >= CACHE_TTL)) {
      console.log(`Removing expired cache for ${key}`);
      delete cache[key]; // 删除过期的缓存
    }
  }
}

// 初始化 Puppeteer
async function initializeBrowser() {
  console.log('Initializing browser...');
  browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage' // 增强 Docker 环境中的稳定性
    ]
  });
  console.log('Browser initialized.');
}

app.all('/render', async (req, res) => {
  const url = req.headers['x-url'];

  if (!url) {
    return res.status(400).send('Missing url');
  }

  // 定义正则表达式
  const urlRegex = /^((https?|ftp):\/\/)?([a-zA-Z0-9\-\.]+)(:[0-9]+)?(\/[^\s]*)?$/;

  if (!urlRegex.test(url)) {
    return res.status(400).send('Invalid URL');
  }

  let page;
  try {
    page = await browser.newPage();

    // 设置自定义 User-Agent
    await page.setUserAgent('server-side-browser');

    // 启用请求拦截
    await page.setRequestInterception(true);

    // 处理每个请求
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // 阻止加载图片、字体和媒体文件
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        request.abort();
        return;
      }

      // 如果请求是 CSS 或 JS 文件并且已经缓存
      if (resourceType === 'stylesheet' || resourceType === 'script') {
        const cachedResource = cache[requestUrl];
        if (cachedResource && (Date.now() - cachedResource.timestamp < CACHE_TTL)) {
          console.log(`Serving ${requestUrl} from cache`);
          request.respond({
            status: 200,
            contentType: resourceType === 'stylesheet' ? 'text/css' : 'application/javascript',
            body: cachedResource.data
          });
          return;
        }
      }
      request.continue(); // 如果没有缓存，继续网络请求
    });

    // 拦截并缓存 CSS/JS 请求
    page.on('response', async (response) => {
      const requestUrl = response.url();
      const resourceType = response.request().resourceType();

      if (resourceType === 'stylesheet' || resourceType === 'script') {
        try {
            const resourceContent = await response.text();
            cache[requestUrl] = { data: resourceContent, timestamp: Date.now() }; // 将 CSS/JS 文件内容和时间戳缓存
        } catch(e) {
            console.error('Failed to cache response for', requestUrl, e.message);
        }
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const html = await page.content(); // 获取渲染后的 HTML

    res.status(200).send(html); // 返回渲染结果，不缓存 HTML
  } catch (error) {
    console.error(error); // 打印错误信息
    res.status(500).send('Rendering failed');
    // 不缓存任何内容，确保在错误时不会保存无效数据
  } finally {
    if (page) {
      await page.close(); // 确保页面被关闭
    }
  }
});


// 启动服务
async function startServer() {
  await initializeBrowser();
  const server = app.listen(port, () => {
    console.log(`Rendering service is running on port ${port}`);
    // 设置定时器，定期清理缓存
    setInterval(cleanUpCache, 5 * 60 * 1000); // 每5分钟清理一次
  });
  return server;
}

startServer().then((server) => {
    // 优雅地关闭浏览器
    const gracefulShutdown = async (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
        server.close(() => {
            console.log('Server closed.');
            process.exit(0);
        });
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
});