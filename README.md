# ServerSideBrowser
Node.js SSR Tool

Server-Side Rendering (SSR) generates HTML content on the server and sends it to the client’s browser, unlike Client-Side Rendering (CSR), which generates content with JavaScript in the browser. SSR improves SEO by speeding up page load times, making it easier for search engines to crawl and index content, enhancing social media sharing with accurate previews, and improving accessibility for assistive technologies. This leads to better search engine rankings and a more user-friendly experience.

## Node.js

### Requirement
 This project require Node.js 18 or latest.

### Project Setup
```sh
npm install
```

### Run it
```sh
node index.js
```

## Docker

### Run it
```sh
docker-compose up -d
```

## API

 This service accepts both GET and POST requests.

|   |    |                    |
|-------|--------|-----------------------------------|
| Port  | 9300   | Port listening                    |
| Path  | /render | path to the service               |
| Header | x-url  | URL of the website to be rendered |

### Run it on terminal
```sh
curl -X GET \
  http://localhost:9300/render \
  -H 'x-url: https://www.example.com/path?p=param'
```

## Use on web server

### Nginx
 Add this to nginx vHost.
```
location / {
  set $full_url "$scheme://$host$request_uri?$query_string";
  proxy_pass http://127.0.0.1:9300/render;
  proxy_set_header x-url $full_url;
}
```

### Nginx for SEO
 Add this to nginx.conf.
```
map $http_user_agent $is_crawler {
    default         0;
    ~*googlebot     1;
    ~*bingbot       1;
    ~*slackbot      1;
    ~*twitterbot    1;
    ~*facebookexternalhit 1;
    ~*baidu         1;
    ~*yahoo          1;
    ~*duckduckbot    1;
    ~*Baiduspider   1;
}
```
 Add this to nginx vHost.
```
location / {
  if ($is_crawler) {
      rewrite ^ /proxy_to_ssr;
  }
}

location /proxy_to_ssr {
  internal;
  set $full_url "$scheme://$host$request_uri?$query_string";
  proxy_pass http://127.0.0.1:9300/render;
  proxy_set_header x-url $full_url;
}
```

#### test SEO on terminal
 Replace the example.com to your website url.
```sh
curl --location 'example.com' \
--header 'User-Agent: Mozilla/5.0 (compatible; googlebot/2.0; +https://developers.google.com/search)'
```

# Support to this project
Please donate to me\
[Donate Link](https://gogetfunding.com/open-source-project-and-library/)\
THANK for your support
