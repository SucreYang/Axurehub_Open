export async function onRequestPost({ request, env }) {
  const { pwd } = await request.json()

  if (pwd !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 })
  }

  return new Response('ok', {
    headers: {
      'Set-Cookie': 'auth=1; Path=/; HttpOnly'
    }
  })
}