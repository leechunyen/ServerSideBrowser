const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = 9300; // 渲染服务的端口

// 解析 JSON 请求体
app.use(express.json());

app.all('/render', async (req, res) => {
  const url = req.headers['x-url'];

  if (!url) {
    return res.status(400).send('Missing url');
  }

// 定義正則表達式
const urlRegex = /^((https?|ftp):\/\/)?([a-zA-Z0-9\-\.]+)(:[0-9]+)?(\/[^\s]*)?$/;

if (!urlRegex.test(url)) {
  return res.status(400).send('Invalid URL');
}

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // 增加超时时间

    const html = await page.content(); // 获取渲染后的 HTML

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