// generate_index.js
const fs = require('fs');
const path = require('path');

// --- ⚙️ 配置区域 ---
const CONFIG = {
    title: "RDS产品文件库",
    subtitle: "Be Still And Know",
    heroImage: "https://images.unsplash.com/photo-1717810135803-830d2c4e0d43?q=80&w=2070&auto=format&fit=crop",
    
    staticDirName: 'Static',
    externalLinksFile: 'links.json',
    ignoreDirs: ['.git', '.github', 'node_modules', 'functions', 'assets', '.txt'],

    //'newest' = 时间倒序;
    sortMode: '时间倒序' 
};
// ----------------

let projectList = [];
let staticPageList = [];
let externalLinks = [];

// --- A. 读取外部链接 ---
const linksPath = path.join(__dirname, CONFIG.externalLinksFile);
if (fs.existsSync(linksPath)) {
    try {
        externalLinks = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
    } catch (e) { console.error("links.json 读取失败:", e.message); }
}

// --- B. 扫描本地文件 ---
const rootItems = fs.readdirSync(__dirname);
rootItems.forEach(item => {
    if (CONFIG.ignoreDirs.includes(item) || item.startsWith('.')) return;

    const fullPath = path.join(__dirname, item);
    const stat = fs.statSync(fullPath);

    // 1. 扫描 Static 文件夹
    if (stat.isDirectory() && item === CONFIG.staticDirName) {
        const files = fs.readdirSync(fullPath);
        files.forEach(f => {
            if (f.endsWith('.html') && f !== 'index.html') {
                const subPath = path.join(fullPath, f);
                const subStat = fs.statSync(subPath);
                
                staticPageList.push({
                    name: f.replace('.html', ''),
                    // 回归纯净链接，不带尾巴
                    link: `./${encodeURIComponent(CONFIG.staticDirName)}/${encodeURIComponent(f)}`,
                    time: subStat.mtimeMs,
                    dateStr: subStat.mtime.toLocaleDateString()
                });
            }
        });
    } 
    // 2. 扫描普通项目文件夹
    else if (stat.isDirectory()) {
        // 🔥【修改点】直接读取文件夹的创建时间 (birthtimeMs)
        // 注意：MacOS 上 birthtime 是创建时间，mtime 是修改时间
        let sortTime = stat.birthtimeMs; 
        
        // ❌【删除或注释掉】下面这三行（不要再去读 index.html 的时间了）
        // const projectIndexPath = path.join(fullPath, 'index.html');
        // if (fs.existsSync(projectIndexPath)) { sortTime = fs.statSync(projectIndexPath).mtimeMs; }

        projectList.push({
            name: item,
            // 链接保持纯净
            link: `./${encodeURIComponent(item)}/`,
            time: sortTime,
            // 显示日期时，会自动把时间戳转为日期
            dateStr: new Date(sortTime).toLocaleDateString()
        });
    }
});

// --- C. 排序逻辑 ---
const sortFn = (a, b) => {
    if (CONFIG.sortMode === '时间倒序') return b.time - a.time;
    if (CONFIG.sortMode === 'oldest') return a.time - b.time;
    if (CONFIG.sortMode === 'name') return a.name.localeCompare(b.name);
    return 0;
};

projectList.sort(sortFn);
staticPageList.sort(sortFn);

// --- D. 生成 HTML (移除所有防缓存 Meta 标签) ---
const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${CONFIG.title}</title>
  <style>
    :root { --primary: #2563eb; --bg: #f8fafc; --card-bg: rgba(255, 255, 255, 0.85); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: var(--bg); color: #1e293b; padding-bottom: 4rem; }
    
    .hero { position: relative; height: 320px; background-image: url('${CONFIG.heroImage}'); background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; margin-bottom: 3rem; }
    .hero::after { content: ''; position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.3); }
    .hero-content { position: relative; z-index: 10; text-align: center; color: white; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(12px); padding: 2rem 4rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.3); box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    .hero h1 { font-size: 2.5rem; margin-bottom: 0.5rem; font-weight: 800; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .hero p { font-size: 1.1rem; opacity: 0.9; font-weight: 500; }

    .container { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }
    
    .section-title { display: flex; align-items: center; justify-content: space-between; margin: 3rem 0 1.5rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }
    .title-left { display: flex; align-items: center; }
    .title-left h2 { font-size: 1.5rem; color: #334155; margin-right: 0.8rem; }
    .badge { background: #e0e7ff; color: #4338ca; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.8rem; font-weight: bold; }
    .sort-tag { font-size: 0.8rem; color: #94a3b8; font-weight: normal; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; }

    .card { background: var(--card-bg); border-radius: 12px; padding: 1.5rem; text-decoration: none; color: inherit; border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 140px; }
    .card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px rgba(0,0,0,0.1); background: white; border-color: var(--primary); }
    
    .card-icon { font-size: 2rem; margin-bottom: 0.8rem; display: block; }
    .card-title { font-weight: 700; font-size: 1.1rem; margin-bottom: 0.3rem; display: block; }
    .card-meta { font-size: 0.8rem; color: #94a3b8; margin-top: 0.5rem; display: flex; align-items: center; }
    .card-arrow { position: absolute; right: 1.5rem; top: 1.5rem; opacity: 0; transition: opacity 0.3s; color: var(--primary); }
    .card:hover .card-arrow { opacity: 1; }
    
    .type-external .card { border-left: 4px solid #10b981; }
    .type-external .card-arrow { transform: rotate(-45deg); }
  </style>
</head>
<body>

  <header class="hero">
    <div class="hero-content">
      <h1>${CONFIG.title}</h1>
      <p>${CONFIG.subtitle}</p>
    </div>
  </header>

  <div class="container">
    ${projectList.length > 0 ? `
    <div class="section-title"><div class="title-left"><h2>📦 正在进行</h2><span class="badge">${projectList.length}</span></div><span class="sort-tag">排序: ${CONFIG.sortMode}</span></div>
    <div class="grid type-project">
      ${projectList.map(item => `<a href="${item.link}" class="card"><span class="card-arrow">↗</span><span class="card-icon">📁</span><span class="card-title">${item.name}</span><div class="card-meta">📅 更新于 ${item.dateStr}</div></a>`).join('')}
    </div>` : ''}
    
    
    ${staticPageList.length > 0 ? `
    <div class="section-title"><div class="title-left"><h2>📄 其他</h2><span class="badge">${staticPageList.length}</span></div><span class="sort-tag">排序: ${CONFIG.sortMode}</span></div>
    <div class="grid type-static">
      ${staticPageList.map(item => `<a href="${item.link}" class="card"><span class="card-arrow">↗</span><span class="card-icon">📃</span><span class="card-title">${item.name}</span><div class="card-meta">📅 更新于 ${item.dateStr}</div></a>`).join('')}
    </div>` : ''}
    
    ${externalLinks.length > 0 ? `
    <div class="section-title"><div class="title-left"><h2>🔗 历史存档</h2><span class="badge" style="background:#d1fae5; color:#047857;">${externalLinks.length}</span></div></div>
    <div class="grid type-external">
      ${externalLinks.map(item => `<a href="${item.link}" target="_blank" class="card"><span class="card-arrow">➜</span><span class="card-icon">${item.icon || '🌐'}</span><span class="card-title">${item.name}</span>${item.desc ? `<div class="card-meta">${item.desc}</div>` : ''}</a>`).join('')}
    </div>` : ''}
    
  </div>
  
  <footer style="text-align: center; margin-top: 4rem; color: #94a3b8; font-size: 0.85rem;">
    Generated at ${new Date().toLocaleString()} <br><br> Design By Sinner🌞
  </footer>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), htmlContent);

// --- E. 生成 _headers (性能优化版) ---
// 既然你要手动改名 (Demo -> Demo-v2)，我们就可以放心大胆地开启缓存！
// 1. HTML: 允许浏览器存，但每次都要问服务器"我过期了吗"。
// 2. 静态资源 (图片/JS/CSS): 允许缓存1年！因为在 v2 文件夹里的图片，永远是 v2 的图片。
const headersContent = `
/*
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable

# 如果你想让项目里的图片加载飞快，可以解开下面的注释
# /*.jpg
#   Cache-Control: public, max-age=31536000, immutable
`;

fs.writeFileSync(path.join(__dirname, '_headers'), headersContent);
console.log('✅ 高性能缓存规则(_headers)已生成！');
console.log(`✅ 首页生成完毕 (纯净版)`);