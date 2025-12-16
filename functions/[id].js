export async function onRequest({ params, env }) {
  const content = await env.PAGES.get(params.id)
  if (!content) {
    return new Response('Not Found', { status: 404 })
  }

  return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>页面</title>
</head>
<body>
${content}
</body>
</html>
`, {
    headers: { 'Content-Type': 'text/html' }
  })
}