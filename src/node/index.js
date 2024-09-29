const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios'); // 用于下载 CSS/JS
const app = express();
const port = 9300; // 渲染服务的端口

// 解析 JSON 请求体
app.use(express.json());

const cache = {}; // 用来缓存渲染的 HTML 和相关的静态资源

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

  // 检查缓存是否存在
  if (cache[url]) {
    console.log(`Cache hit for ${url}`);
    return res.status(200).send(cache[url].html); // 直接返回缓存的 HTML
  }

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // 启用请求拦截
    await page.setRequestInterception(true);

    // 处理每个请求
    page.on('request', (request) => {
      const requestUrl = request.url();

      // 如果请求是 CSS 或 JS 文件并且已经缓存
      if (requestUrl.endsWith('.css') || requestUrl.endsWith('.js')) {
        const cachedResource = cache[requestUrl];
        if (cachedResource) {
          console.log(`Serving ${requestUrl} from cache`);
          request.respond({
            status: 200,
            contentType: requestUrl.endsWith('.css') ? 'text/css' : 'application/javascript',
            body: cachedResource
          });
          return;
        }
      }
      request.continue(); // 如果没有缓存，继续网络请求
    });

    // 拦截并缓存 CSS/JS 请求
    page.on('response', async (response) => {
      const requestUrl = response.url();

      if (requestUrl.endsWith('.css') || requestUrl.endsWith('.js')) {
        const resourceContent = await response.text();
        cache[requestUrl] = resourceContent; // 将 CSS/JS 文件内容缓存
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const html = await page.content(); // 获取渲染后的 HTML

    // 缓存渲染后的 HTML
    cache[url] = { html };

    await browser.close();

    res.status(200).send(html); // 返回渲染结果
  } catch (error) {
    console.error(error); // 打印错误信息
    res.status(500).send('Rendering failed');
  }
});

app.listen(port, () => {
  console.log(`Rendering service is running on port ${port}`);
});
