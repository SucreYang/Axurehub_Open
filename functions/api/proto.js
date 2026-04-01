// functions/api/proto.js
// Axure原型管理 - 优化版
// 采用前端分批上传策略，解决云端解压超时与乱码问题


function getMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimes = {
    html: 'text/html;charset=UTF-8',
    htm:  'text/html;charset=UTF-8',
    js:   'application/javascript;charset=UTF-8',
    css:  'text/css;charset=UTF-8',
    json: 'application/json;charset=UTF-8',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    svg:  'image/svg+xml',
    ico:  'image/x-icon',
    woff: 'font/woff',
    woff2:'font/woff2',
    ttf:  'font/ttf',
    eot:  'application/vnd.ms-fontobject',
    xml:  'application/xml',
    txt:  'text/plain;charset=UTF-8',
    map:  'application/json;charset=UTF-8',
  };
  return mimes[ext] || 'application/octet-stream';
}

function checkAdmin(request, env) {
  const adminPassword = env.ADMIN_PASSWORD || "910217";
  return request.headers.get("X-Admin-Key") === adminPassword;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  
  if (!kv || !r2) {
    return new Response(JSON.stringify({ error: "KV or R2 not bound" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // GET：列表
  if (request.method === "GET") {
    try {
      const protos = [];
      let cursor = undefined;
      do {
        const listOpts = { prefix: "proto:", limit: 1000 };
        if (cursor) listOpts.cursor = cursor;
        const list = await kv.list(listOpts);
        for (const key of list.keys.filter(k => k.name.endsWith(":manifest"))) {
          const raw = await kv.get(key.name);
          if (raw) protos.push(JSON.parse(raw));
        }
        if (list.list_complete) break;
        cursor = list.cursor;
      } while (true);
      protos.sort((a, b) => b.uploadTime - a.uploadTime);
      return new Response(JSON.stringify(protos), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify([]), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
    }
  }

  if (!checkAdmin(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders() });
  }

  // POST：原型上传 (支持分块)
  if (request.method === "POST") {
    const action = url.searchParams.get("action"); // 'upload' | 'finish'
    const name = url.searchParams.get("name");
    const safeName = name?.trim();

    if (!safeName) return new Response(JSON.stringify({ error: "name required" }), { status: 400 });

    // 1. 文件块上传
    if (action === "upload" || !action) {
      const formData = await request.formData();
      const files = formData.getAll("file");
      
      await Promise.all(files.map(async (file) => {
        if (!(file instanceof File)) return;
        // 这里的 file.name 已经是前端提取过的相对路径
        await r2.put(`proto/${safeName}/${file.name}`, await file.arrayBuffer(), {
          httpMetadata: { contentType: getMime(file.name) }
        });
      }));

      // 如果没有显式 action，则视为单次上传（向下兼容）
      if (!action) {
        const filePaths = files.map(f => f.name);
        await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
          name: safeName, status: "ready", fileCount: filePaths.length, uploadTime: Date.now(), files: filePaths
        }));
      } else {
        // 异步分块模式：初始化状态
        const existing = await kv.get(`proto:${safeName}:manifest`);
        if (!existing) {
          await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
            name: safeName, status: "processing", uploadTime: Date.now(), fileCount: 0, files: []
          }));
        }
      }
      return new Response(JSON.stringify({ success: true }));
    }

    // 2. 完成信号
    if (action === "finish") {
      const { files } = await request.json();
      if (!files || !Array.isArray(files)) return new Response(JSON.stringify({ error: "manifest required" }), { status: 400 });

      await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
        name: safeName, status: "ready", fileCount: files.length, uploadTime: Date.now(), files: files
      }));
      return new Response(JSON.stringify({ success: true }));
    }
  }

  // DELETE
  if (request.method === "DELETE") {
    const name = url.searchParams.get("name");
    if (!name) return new Response(JSON.stringify({ error: "name required" }), { status: 400 });

    const manifestRaw = await kv.get(`proto:${name}:manifest`);
    const manifest = manifestRaw ? JSON.parse(manifestRaw) : { name, status: "unknown", uploadTime: Date.now() };

    // 更新状态为正在删除，防止重复操作
    // 更新状态为正在删除，并添加操作时间戳，以便 UI 判断是否卡死
    await kv.put(`proto:${name}:manifest`, JSON.stringify({ ...manifest, status: "deleting", lastActionTime: Date.now() }));

    context.waitUntil((async () => {
      try {
        // 使用 R2 扫描列表进行物理删除，不依赖 KV 中的文件清单
        let truncated = true;
        let cursor = undefined;
        while (truncated) {
          const list = await r2.list({ prefix: `proto/${name}/`, cursor });
          const objects = list.objects;
          if (objects.length > 0) {
            // 每 50 个文件一组进行分批异步删除
            for (let i = 0; i < objects.length; i += 50) {
              const batch = objects.slice(i, i + 50);
              await Promise.all(batch.map(o => r2.delete(o.key)));
            }
          }
          truncated = list.truncated;
          cursor = list.cursor;
        }
        // 最后清理元数据
        await kv.delete(`proto:${name}:manifest`);
      } catch (e) {
        console.error("Delete failed", e);
        await kv.put(`proto:${name}:manifest`, JSON.stringify({ ...manifest, status: "error", error: e.message }));
      }
    })());
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Method Not Allowed", { status: 405 });
}
