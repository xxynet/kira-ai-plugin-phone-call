/** Use the current WebUI session before a token stored under another port. */
async function fetchPersonaResource(path, signal) {
  const options = { credentials: 'same-origin', cache: 'no-store', signal }
  const response = await fetch(path, options)
  if (response.status !== 401) return response

  const token = window.PluginPageContext.getToken()
  if (!token) return response
  return fetch(path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token },
  })
}

export async function loadPersona(signal) {
  const response = await fetchPersonaResource('/api/personas/active', signal)
  if (response.status === 404) return { id: null, name: '', referenceImagePath: null }
  if (!response.ok) {
    const error = new Error('Unable to load active persona')
    error.status = response.status
    throw error
  }

  const persona = await response.json()
  return {
    id: persona.id,
    name: persona.name || '',
    referenceImagePath: persona.reference_image_path || null,
  }
}

export async function loadPersonaAvatar(persona, signal) {
  if (!persona.id || !persona.referenceImagePath) return null
  const response = await fetchPersonaResource(
    '/api/personas/' + encodeURIComponent(persona.id) + '/reference-image',
    signal,
  )
  return response.ok ? response.blob() : null
}
