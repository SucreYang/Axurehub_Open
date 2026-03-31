// functions/_middleware.js

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // --- ⚙️ 配置区域 ---
  const PASSWORD = "zhikoudai"; // 你的密码
  const COOKIE_NAME = "site_access_token";
  const COOKIE_VALUE = "authorized_user"; // Cookie 暗号
  const MAX_AGE = 60 * 60 * 24 * 1; // 30天有效期
  
  // 页面标题和提示语
  const PAGE_TITLE = "INTERNAL DISTRIBUTION ONLY"; 
  const TIP_TEXT = "请联系管理员获取访问密码";
  // ----------------

  // 1. 检查 Cookie：如果有且正确，直接放行
  const cookieString = request.headers.get("Cookie") || "";
  if (cookieString.includes(`${COOKIE_NAME}=${COOKIE_VALUE}`)) {
    return next();
  }

  // 2. 处理 POST 请求（用户提交了密码）
  if (request.method === "POST") {
    const formData = await request.formData();
    const inputPassword = formData.get("password");

    if (inputPassword === PASSWORD) {
      // 密码正确！重定向回当前页面，并植入 Cookie
      return new Response(null, {
        status: 302,
        headers: {
          "Location": url.pathname, // 刷新当前页
          "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Strict`
        }
      });
    } else {
      // 密码错误，重新渲染页面，并带上错误提示
      return new Response(getHtml(PAGE_TITLE, TIP_TEXT, "密码错误，请重试"), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }
  }

  // 3. 默认情况：没有 Cookie 也没提交密码，显示漂亮的登录页
  return new Response(getHtml(PAGE_TITLE, TIP_TEXT), {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}

// --- 🎨 UI 渲染函数 (这里修改样式) ---
function getHtml(title, tip, error = null) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    /* 基础重置 */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      /* 背景配置：你可以换成图片 url('https://images.unsplash.com/photo-1717810135803-830d2c4e0d43') */
      background: url('https://images.unsplash.com/photo-1717810135803-830d2c4e0d43');
      background-repeat: no-repeat; /* 不重复 */
      background-size: cover; /* 覆盖整个区域 */
      background-position: center; /* 居中 */
//       background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);color: #333;
    }

    /* 卡片容器 */
    .card {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px); /* 磨砂玻璃效果 */
      padding: 2.5rem;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      width: 100%;
      max-width: 400px;
      text-align: center;
      transition: transform 0.3s ease;
    }
    
    .card:hover { transform: translateY(-5px); }

    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #1a202c; }
    p { color: #718096; margin-bottom: 2rem; font-size: 0.95rem; }

    /* 输入框样式 */
    .input-group { margin-bottom: 1.5rem; text-align: left; }
    
    input {
      width: 100%;
      padding: 0.8rem 1rem;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.2s;
      outline: none;
    }
    
    input:focus { border-color: #667eea; }

    /* 按钮样式 */
    button {
      width: 100%;
      padding: 0.8rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    button:hover { background: #5a67d8; }

    /* 错误提示 */
    .error {
      color: #e53e3e;
      background: #fff5f5;
      padding: 0.5rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
      border: 1px solid #feb2b2;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
    
    <h1>${title}</h1>
    <p>${tip}</p>

    ${error ? `<div class="error">${error}</div>` : ''}

    <form method="POST">
      <div class="input-group">
        <input type="password" name="password" placeholder="输入访问密码..." required autofocus>
      </div>
      <button type="submit">授权登录</button>
    </form>
  </div>
</body>
</html>
  `;
}