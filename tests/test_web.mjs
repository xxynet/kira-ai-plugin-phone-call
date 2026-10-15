import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../web/js/', import.meta.url))
let serial = 0
async function fresh(name) {
  const source = await readFile(root + name + '.js', 'utf8')
  return import('data:text/javascript;base64,' + Buffer.from(source + '\n// ' + serial++).toString('base64'))
}

test('all Chinese and English UI keys match and have translations', async () => {
  globalThis.document = { documentElement: {} }
  const {messages, setLocale, t} = await fresh('i18n')
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort())
  for (const lang of ['zh', 'en']) {
    setLocale(lang)
    for (const key of Object.keys(messages[lang])) assert.ok(t(key)?.trim(), key)
  }
})

test('valid session cookies take priority over stale tokens from another port', async () => {
  globalThis.window = {PluginPageContext:{getToken:() => { throw Error('stale token must not be read') }}}
  const requests = []
  globalThis.fetch = async (path, options) => {
    requests.push({path, options})
    return path === '/api/personas/active'
      ? Response.json({id:'persona / one', name:'小夏', reference_image_path:'private.png'})
      : new Response('fixture-image', {headers:{'Content-Type':'image/png'}})
  }
  const {loadPersona, loadPersonaAvatar} = await fresh('persona')
  const persona = await loadPersona(new AbortController().signal)
  assert.equal(persona.name, '小夏')
  assert.equal(requests.length, 1)
  const image = await loadPersonaAvatar(persona)
  assert.equal(await image.text(), 'fixture-image')
  assert.equal(requests[1].path, '/api/personas/persona%20%2F%20one/reference-image')
  for (const request of requests) {
    assert.equal(request.options.headers, undefined)
    assert.equal(request.options.credentials, 'same-origin')
    assert.equal(request.options.cache, 'no-store')
  }
})

test('a token-only session is retried after the cookie request is unauthorized', async () => {
  globalThis.window = {PluginPageContext:{getToken:() => 'fixture-session'}}
  const requests = []
  globalThis.fetch = async (path, options) => {
    requests.push(options)
    return options.headers?.Authorization === 'Bearer fixture-session'
      ? Response.json({id:'persona', name:'小夏'})
      : new Response('', {status:401})
  }
  const {loadPersona} = await fresh('persona')
  assert.equal((await loadPersona()).name, '小夏')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].headers, undefined)
  assert.equal(requests[1].headers.Authorization, 'Bearer fixture-session')
})

test('missing persona or reference image has a usable contact fallback', async () => {
  const {loadPersona, loadPersonaAvatar} = await fresh('persona')
  globalThis.fetch = async () => new Response('', {status:404})
  const empty = await loadPersona()
  assert.deepEqual(empty, {id:null, name:'', referenceImagePath:null})
  assert.equal(await loadPersonaAvatar(empty), null)
  assert.equal(await loadPersonaAvatar({id:'persona', referenceImagePath:'missing.png'}), null)
  globalThis.window = {PluginPageContext:{getToken:() => null}}
  globalThis.fetch = async () => new Response('', {status:401})
  await assert.rejects(loadPersona(), error => error.status === 401)
})

test('persona details finish before a slow or failed avatar download', async () => {
  const {loadPersona, loadPersonaAvatar} = await fresh('persona')
  let imageRequested = false
  globalThis.fetch = async (path) => {
    if (path === '/api/personas/active') return Response.json({id:'persona', name:'小夏', reference_image_path:'large.png'})
    imageRequested = true
    throw new DOMException('Image request timed out', 'AbortError')
  }
  const persona = await loadPersona()
  assert.equal(persona.name, '小夏')
  assert.equal(imageRequested, false)
  await assert.rejects(loadPersonaAvatar(persona), {name:'AbortError'})
  assert.equal(persona.name, '小夏')
})
test('reply mute affects current and queued audio; stale playback cannot interrupt a new call', async () => {
  const clips = []
  globalThis.Audio = class {
    constructor() { clips.push(this) }
    play() { return new Promise((resolve, reject) => { this.reject = reject }) }
    pause() { this.paused = true }
  }
  const player = await fresh('player')
  let finished = 0
  player.onStateChange(() => {}, () => { finished++ })
  player.enqueue('first', 'audio/mpeg')
  player.enqueue('second', 'audio/mpeg')
  player.setMuted(true)
  assert.equal(clips[0].muted, true)
  clips[0].onended()
  assert.equal(clips[1].muted, true)
  player.setMuted(false)
  assert.equal(clips[1].muted, false)
  player.stopAll()
  player.enqueue('third', 'audio/mpeg')
  clips[1].reject(new Error('old call was stopped'))
  await new Promise(setImmediate)
  assert.equal(player.isPlaying(), true)
  assert.equal(finished, 0)
  clips[2].onended()
  assert.equal(player.isPlaying(), false)
  assert.equal(finished, 1)
})

test('microphone mute disables the track and discards a pending utterance; disposal detaches events', async () => {
  const originalPerformance = globalThis.performance
  let now = 1
  let rms = 0
  let detectVoice
  const recordings = []
  const track = {enabled:true, stopped:false, stop() { this.stopped = true }}
  const stream = {active:true, getTracks:() => [track], getAudioTracks:() => [track]}
  class FakeRecorder {
    static isTypeSupported() { return true }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; recordings.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  globalThis.performance = {now: () => now}
  globalThis.MediaRecorder = FakeRecorder
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{mediaDevices:{getUserMedia:async () => stream}}})
  globalThis.window = {
    MediaRecorder:FakeRecorder,
    setInterval(fn) { detectVoice = fn; return 0 },
    AudioContext:class {
      state = 'running'
      async resume() {}
      async close() { this.state = 'closed' }
      createMediaStreamSource() { return {connect() {}} }
      createAnalyser() { return {fftSize:2048, getFloatTimeDomainData(samples) { samples.fill(rms) }} }
    },
  }
  try {
    const recorder = await fresh('recorder')
    assert.equal(await recorder.init(), true)
    let utterances = 0
    recorder.start(() => { utterances++ })
    rms = .12; now = 50; detectVoice()
    now = 200; detectVoice()
    rms = 0; now = 1000; detectVoice()
    now = 1900; detectVoice()
    assert.equal(recordings[0].state, 'inactive')
    recorder.setMuted(true)
    recorder.setListening(false)
    assert.equal(track.enabled, false)
    recordings[0].ondataavailable({data:new Blob(['fixture'])})
    recordings[0].onstop()
    assert.equal(utterances, 0)
    recorder.setMuted(false)
    recorder.setListening(true)
    assert.equal(track.enabled, true)
    await recorder.dispose()
    assert.equal(track.stopped, true)
    assert.equal(recordings.at(-1).onstop, null)
    assert.equal(recordings.at(-1).ondataavailable, null)
    assert.equal(recorder.isReady(), false)
  } finally {
    globalThis.performance = originalPerformance
  }
})