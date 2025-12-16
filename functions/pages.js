import { isAuthed } from './auth'

export async function onRequest({ request, env }) {
  if (!isAuthed(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)

  if (request.method === 'GET') {
    const list = await env.PAGES.list()
    return Response.json(list.keys.map(k => ({
      id: k.name,
      title: k.metadata.title
    })))
  }

  if (request.method === 'POST') {
    const { title, content } = await request.json()
    const id = Date.now().toString()

    await env.PAGES.put(id, content, {
      metadata: { title }
    })

    return Response.json({ id })
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id')
    await env.PAGES.delete(id)
    return new Response('ok')
  }
}