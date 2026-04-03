// functions/api/proto.js
// Axure 原型管理 v3 — 预签名 URL 直传方案 (基于 docs/proto.js 优化)

const _enc = new TextEncoder();

async function _hmac(key, data) {
  const k = typeof key  === 'string' ? _enc.encode(key)  : key;
  const d = typeof data === 'string' ? _enc.encode(data) : data;
  const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, d));
}

const _hex = buf => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');

async function _sha256hex(str) {
  return _hex(new Uint8Array(await crypto.subtle.digest('SHA-256', _enc.encode(str))));
}

// 更加严格的 S3 V4 编码函数
function awsEncode(str, encodeSlash = false) {
  let result = encodeURIComponent(str.normalize('NFC'))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  if (!encodeSlash) {
    result = result.replace(/%2F/g, '/');
  }
  return result;
}

async function presignPut({ accountId, bucket, accessKeyId, secretKey, r2Key, contentType, expiresIn = 3600 }) {
  const host   = `${bucket}.${accountId}.r2.cloudflarestorage.com`.toLowerCase();
  const region = 'auto';
  const svc    = 's3';

  // 严格路径编码
  const encodedPath = awsEncode(r2Key.startsWith('/') ? r2Key : '/' + r2Key, false);

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credScope = `${dateStamp}/${region}/${svc}/aws4_request`;

  // 预签名参数
  const params = new URLSearchParams();
  params.set('X-Amz-Algorithm',      'AWS4-HMAC-SHA256');
  params.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');
  params.set('X-Amz-Credential',     `${accessKeyId}/${credScope}`);
  params.set('X-Amz-Date',           amzDate);
  params.set('X-Amz-Expires',        String(expiresIn));
  params.set('X-Amz-SignedHeaders',  'host'); // 核心修复：仅签名 host，避免 Content-Type 不匹配

  const sortedKeys = Array.from(params.keys()).sort();
  const canonicalQS = sortedKeys
    .map(k => `${awsEncode(k, true)}=${awsEncode(params.get(k), true)}`)
    .join('&');

  // 只包含 host 头部
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = [
    'PUT',
    encodedPath,
    canonicalQS,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await _sha256hex(canonicalRequest),
  ].join('\n');

  let sk = await _hmac('AWS4' + secretKey, dateStamp);
  sk = await _hmac(sk, region);
  sk = await _hmac(sk, svc);
  sk = await _hmac(sk, 'aws4_request');

  const sig = _hex(await _hmac(sk, stringToSign));
  
  // 生成最终 URL
  return `https://${host}${encodedPath}?${canonicalQS}&X-Amz-Signature=${sig}`;
}

function getMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ({
    html: 'text/html;charset=UTF-8',   htm: 'text/html;charset=UTF-8',
    js:   'application/javascript;charset=UTF-8',
    css:  'text/css;charset=UTF-8',    json: 'application/json;charset=UTF-8',
    png:  'image/png',                 jpg:  'image/jpeg', jpeg: 'image/jpeg',
    gif:  'image/gif',                 svg:  'image/svg+xml;charset=UTF-8',
    ico:  'image/x-icon',              woff: 'font/woff',  woff2: 'font/woff2',
    ttf:  'font/ttf',                  eot:  'application/vnd.ms-fontobject',
    xml:  'application/xml;charset=UTF-8',           
    txt:  'text/plain;charset=UTF-8',
    map:  'application/json;charset=UTF-8',
  })[ext] || 'application/octet-stream';
}

const checkAdmin = (req, env) => req.headers.get('X-Admin-Key') === env.ADMIN_PASSWORD;

const cors = () => ({
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
});

const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors(), 'Content-Type': 'application/json' },
});

async function pLimit(items, fn, limit = 5) {
  let idx = 0;
  const results = [];
  async function worker() {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isSafePath(p) {
  if (!p || typeof p !== 'string') return false;
  const n = p.replace(/\\/g, '/');
  return !n.startsWith('/') && !n.includes('\0') &&
    !n.split('/').some(s => s === '..' || s === '.');
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  if (!kv || !r2) return jsonResp({ error: 'KV or R2 not bound' }, 500);

  if (request.method === 'GET') {
    try {
      const protos = [];
      let cursor;
      do {
        const opts = { prefix: 'proto:', limit: 1000 };
        if (cursor) opts.cursor = cursor;
        const list = await kv.list(opts);
        const keys = list.keys.filter(k => k.name.endsWith(':manifest'));
        const raws = await pLimit(keys, k => kv.get(k.name), 10);
        for (const raw of raws) if (raw) protos.push(JSON.parse(raw));
        if (list.list_complete) break;
        cursor = list.cursor;
      } while (true);
      protos.sort((a, b) => b.uploadTime - a.uploadTime);
      return jsonResp(protos);
    } catch { return jsonResp([]); }
  }

  if (!checkAdmin(request, env)) return jsonResp({ error: 'Unauthorized' }, 403);

  if (request.method === 'POST') {
    const action   = url.searchParams.get('action');
    const name     = url.searchParams.get('name');
    const safeName = name?.trim();
    if (!safeName) return jsonResp({ error: 'name required' }, 400);

    if (action === 'presign') {
      const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
      if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return jsonResp({ error: '缺少 R2 签名环境变量' }, 500);
      }

      let body;
      try { body = await request.json(); }
      catch { return jsonResp({ error: '无效的 JSON body' }, 400); }

      const { files } = body;
      if (!Array.isArray(files) || !files.length) return jsonResp({ error: 'files 不能为空' }, 400);

      for (const f of files) {
        if (!isSafePath(f.name)) return jsonResp({ error: `不安全路径: ${f.name}` }, 400);
      }

      const urls = await pLimit(files, async (f) => {
        const normalizedFileName = f.name.normalize('NFC');
        const contentType = getMime(normalizedFileName);
        return {
          name:        normalizedFileName,
          contentType: contentType,
          url: await presignPut({
            accountId:   R2_ACCOUNT_ID,
            bucket:      R2_BUCKET_NAME,
            accessKeyId: R2_ACCESS_KEY_ID,
            secretKey:   R2_SECRET_ACCESS_KEY,
            r2Key:       `proto/${safeName.normalize('NFC')}/${normalizedFileName}`,
            contentType: contentType,
          }),
        };
      }, 10);

      if (!await kv.get(`proto:${safeName}:manifest`)) {
        await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
          name: safeName, status: 'processing',
          uploadTime: Date.now(), fileCount: 0, files: [],
        }));
      }

      return jsonResp({ urls });
    }

    if (action === 'finish') {
      let body;
      try { body = await request.json(); }
      catch { return jsonResp({ error: '无效的 JSON body' }, 400); }

      const { files } = body;
      if (!Array.isArray(files)) return jsonResp({ error: 'files 必填' }, 400);

      await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
        name: safeName, status: 'ready',
        fileCount: files.length, uploadTime: Date.now(), files,
      }));
      return jsonResp({ success: true });
    }

    return jsonResp({ error: `未知 action: ${action}` }, 400);
  }

  if (request.method === 'DELETE') {
    const name = url.searchParams.get('name');
    if (!name) return jsonResp({ error: 'name required' }, 400);

    const raw      = await kv.get(`proto:${name}:manifest`);
    const manifest = raw ? JSON.parse(raw) : { name, status: 'unknown', uploadTime: Date.now() };

    await kv.put(`proto:${name}:manifest`, JSON.stringify({
      ...manifest, status: 'deleting', lastActionTime: Date.now(),
    }));

    context.waitUntil((async () => {
      try {
        let truncated = true, cursor;
        while (truncated) {
          const list = await r2.list({ prefix: `proto/${name}/`, cursor });
          if (list.objects.length) await pLimit(list.objects, o => r2.delete(o.key), 10);
          truncated = list.truncated;
          cursor    = list.cursor;
        }
        await kv.delete(`proto:${name}:manifest`);
      } catch (e) {
        await kv.put(`proto:${name}:manifest`, JSON.stringify({
          ...manifest, status: 'error', error: e.message,
        }));
      }
    })());

    return jsonResp({ success: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}