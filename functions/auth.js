export function isAuthed(request) {
  return request.headers.get('Cookie')?.includes('auth=1')
}