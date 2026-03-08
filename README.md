# ServerSideBrowser
## A high-performance Node.js SSR tool designed for modern SPA SEO.

Server-Side Rendering (SSR) generates HTML content on the server and sends it to the client’s browser. Unlike Client-Side Rendering (CSR), SSR improves SEO by speeding up page load times, making it easier for search engines to crawl and index content, and enhancing social media sharing with accurate previews.

## 🚀 Key Features
* **Persistent Browser Instance**: Fast startup and lower CPU overhead by reusing a shared Chromium instance.
* **Smart Resource Filtering**: Automatically skips non-essential assets (**Images, Fonts, Media**) to boost rendering speed.
* **Memory Caching Engine**: Built-in TTL-based caching for **CSS and JS** to minimize network round-trips.
* **Production Ready**: Pre-configured for **Docker** and Linux environments (shared memory fixes included).
* **Graceful Shutdown**: Properly cleans up browser processes on service exit.

## How it work?
The following diagram shows how the SSR tool handles requests from different users (Normal Users vs. Crawlers):

```mermaid
graph TD
    User((User/Crawler)) --> Nginx{Nginx}
    Nginx -- Is Crawler? --> SSR[ServerSideBrowser Node.js]
    Nginx -- Not Crawler --> Frontend[Static Files / CSR]
    SSR -- Fetch & Render --> Website((Your Website))
    Website -- Return HTML --> SSR
    SSR -- Full Rendered HTML --> User
    Frontend -- JS/App Shell --> User
```

## 📋 Requirements
* **Node.js**: Version 18 or later.
* **Chromium**: Must be installed on the server. (Note: If using Docker, Chromium is pre-installed in the container.)

## Quick Start

Node.js
```sh
npm install
node index.js
```

Docker
```sh
docker-compose up -d
```

## 🔌 API Reference

 This service accepts both GET and POST requests.

| Type        | Value               | Description                       | Required  |
|-------------|---------------------|-----------------------------------|-----------|
| Port        | 9300                | Port listening                    | -         |
| Path        | /render             | path to the service               | -         |
| User Agent  | server-side-browser | User-agent                        | -         |
| Header      | x-url               | URL of the website to be rendered | ✅        | 

### Test via Terminal
```sh
curl -X GET \
  http://localhost:9300/render \
  -H 'x-url: https://www.example.com/path?p=param'
```

## 🌐 Web Server Configuration (Nginx)

### 1. Define Crawler Detection
 Add this to the **http** block in nginx.conf:
```conf
map $http_user_agent $is_crawler {
  default               0;
  ~*server_side_browser 0; # Ensure the SSR tool itself is not forwarded repeatedly.

  # Mainstream search engines
  ~*googlebot           1;
  ~*adsbot-google       1; # Google ad crawler
  ~*applebot            1; # Apple device search (Siri/Safari)
  ~*bingbot             1;
  ~*duckduckbot         1;
  ~*baidu               1;
  ~*yandex              1;
  ~*yahoo               1;

  # Community platforms and tools
  ~*facebookexternalhit 1;
  ~*twitterbot          1;
  ~*slackbot            1;
  ~*whatsapp            1; # To display the correct preview card on WhatsApp
  ~*linkedinbot         1;
  ~*discordbot          1;
}
```

### 2. Configure Virtual Host (VHost)
Add this to your **server** block in nginx.conf.\
\
Option A: Simple (Force all traffic to SSR)
```conf
location / {
  set $full_url "$scheme://$host$request_uri";
  proxy_pass http://127.0.0.1:9300/render;
  proxy_set_header x-url $full_url;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
 Option B: Advance (SEO only - recommended)
```conf
location / {
  if ($is_crawler) {
    rewrite ^ /proxy_to_ssr last;
  }
  # Your original frontend configuration (e.g., try_files $uri /index.html)
  try_files $uri $uri/ /index.html;
}

location /proxy_to_ssr {
  internal;
  set $full_url "$scheme://$host$request_uri";
  proxy_pass http://127.0.0.1:9300/render;
  proxy_set_header x-url $full_url;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 3. Verify SEO Setup
Test if Googlebot is correctly routed to the SSR service:
```sh
curl -v -H "User-Agent: Googlebot" "https://example.com/path?p=param"
```

## ⚖️ License
This project is licensed under the [GNU General Public License v3.0](LICENSE). 
Feel free to use, modify, and distribute it, provided that the same freedoms are preserved.

## ❤️ Supporting Me
  [Donate Link](https://gogetfunding.com/open-source-project-and-library/)\
  Thank you for your support!
