import { useState, useEffect, useRef, useCallback } from 'react'

const BAUD_RATES = [74880, 9600, 115200, 57600, 38400, 19200]

export default function SerialMonitor() {
  const [connected, setConnected] = useState(false)
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [baudRate, setBaudRate] = useState(74880)
  const [errorMsg, setErrorMsg] = useState('')
  const consoleRef = useRef(null)
  const readerRef = useRef(null)
  const portRef = useRef(null)
  const activeRef = useRef(false)

  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator

  const addLog = useCallback((line) => {
    const now = new Date().toLocaleTimeString('id-ID', { hour12: false })
    setLogs(prev => {
      const next = [...prev, { t: now, msg: line, id: Date.now() + Math.random() }]
      return next.length > 1000 ? next.slice(-1000) : next
    })
  }, [])

  const readLoop = useCallback(async (port) => {
    const decoder = new TextDecoderStream()
    const pipeDone = port.readable.pipeTo(decoder.writable)
    const reader = decoder.readable.getReader()
    readerRef.current = reader
    let buffer = ''

    try {
      while (activeRef.current) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop()
        lines.forEach(line => {
          const trimmed = line.replace(/\r/g, '')
          if (trimmed) addLog(trimmed)
        })
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        addLog(`[ERROR] Koneksi terputus: ${err.message}`)
      }
    } finally {
      try { reader.releaseLock() } catch {}
      try { await pipeDone } catch {}
    }
  }, [addLog])

  const connect = async () => {
    if (!isSupported) return
    setErrorMsg('')
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate })
      // Deassert DTR segera setelah buka port agar ESP8266 tidak auto-reset
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }) } catch {}
      portRef.current = port
      activeRef.current = true
      setConnected(true)
      addLog('[SISTEM] Port terbuka — menunggu ESP8266 siap...')
      readLoop(port)
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        setErrorMsg(`Gagal terhubung: ${err.message}`)
      }
    }
  }

  const disconnect = useCallback(async () => {
    activeRef.current = false
    try { await readerRef.current?.cancel() } catch {}
    try { await portRef.current?.close() } catch {}
    portRef.current = null
    readerRef.current = null
    setConnected(false)
    addLog('[SISTEM] Koneksi diputus.')
  }, [addLog])

  useEffect(() => {
    return () => {
      activeRef.current = false
      readerRef.current?.cancel().catch(() => {})
      portRef.current?.close().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const clearLogs = () => setLogs([])

  const getLogColor = (msg) => {
    if (msg.startsWith('[ERROR]') || msg.includes('GAGAL') || msg.includes('ERROR')) return '#f87171'
    if (msg.startsWith('[ALARM]') || msg.includes('ALARM')) return '#fb923c'
    if (msg.startsWith('[RFID]') && msg.includes('Akses OK')) return '#4ade80'
    if (msg.startsWith('[FP]') && msg.includes('COCOK')) return '#4ade80'
    if (msg.startsWith('[ENROLL')) return '#a78bfa'
    if (msg.startsWith('[SISTEM]')) return '#60a5fa'
    if (msg.startsWith('[HW]')) return '#34d399'
    if (msg.startsWith('[LOG]') || msg.startsWith('[CMD]')) return '#94a3b8'
    if (msg.startsWith('[SB]') || msg.startsWith('[CACHE]')) return '#7dd3fc'
    if (msg.startsWith('[STATE]')) return '#fbbf24'
    if (msg.startsWith('[WiFi]') || msg.startsWith('[NTP]')) return '#a3e635'
    return '#e2e8f0'
  }

  return (
    <div style={{ animation: 'fade-in 0.4s ease-out' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Serial Monitor</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Pantau log Arduino ESP8266 secara real-time via USB
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Baud rate selector */}
          <select
            value={baudRate}
            onChange={e => setBaudRate(Number(e.target.value))}
            disabled={connected}
            style={{
              padding: '8px 12px', borderRadius: '9px',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              fontSize: '13px', cursor: connected ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono)', opacity: connected ? 0.6 : 1,
            }}
          >
            {BAUD_RATES.map(r => (
              <option key={r} value={r}>{r} baud</option>
            ))}
          </select>

          {/* Connect / Disconnect */}
          {!connected ? (
            <button
              onClick={connect}
              disabled={!isSupported}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '9px 16px', borderRadius: '10px', border: 'none',
                background: isSupported
                  ? 'linear-gradient(135deg,#22c55e,#15803d)'
                  : 'var(--bg-card)',
                color: isSupported ? 'white' : 'var(--text-muted)',
                fontSize: '13.5px', fontWeight: 700,
                cursor: isSupported ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-sans)',
                boxShadow: isSupported ? '0 4px 14px rgba(34,197,94,0.35)' : 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>usb</span>
              Hubungkan USB
            </button>
          ) : (
            <button
              onClick={disconnect}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '9px 16px', borderRadius: '10px', border: 'none',
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171', fontSize: '13.5px', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>usb_off</span>
              Putuskan
            </button>
          )}
        </div>
      </div>

      {/* Browser not supported warning */}
      {!isSupported && (
        <div style={{
          padding: '14px 18px', borderRadius: '12px', marginBottom: '16px',
          background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span className="material-symbols-outlined" style={{ color: '#fb923c', fontSize: '20px' }}>warning</span>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            Browser Anda tidak mendukung Web Serial API. Gunakan <strong>Chrome, Edge, atau Opera</strong> versi terbaru.
          </p>
        </div>
      )}

      {/* Connection error */}
      {errorMsg && (
        <div style={{
          padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span className="material-symbols-outlined" style={{ color: '#f87171', fontSize: '18px' }}>error</span>
          <span style={{ fontSize: '13px', color: '#f87171' }}>{errorMsg}</span>
        </div>
      )}

      {/* Console panel */}
      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--border-table)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block',
                background: connected ? '#4ade80' : 'var(--text-subtle)',
                boxShadow: connected ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
                animation: connected ? 'pulse-icon 2s ease-in-out infinite' : 'none',
              }} />
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
                {connected ? 'Terhubung' : 'Tidak Terhubung'}
              </span>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>
              {logs.length} baris
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Auto scroll toggle */}
            <button
              onClick={() => setAutoScroll(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 10px', borderRadius: '7px',
                border: `1px solid ${autoScroll ? 'rgba(59,130,246,0.4)' : 'var(--border-card)'}`,
                background: autoScroll ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: autoScroll ? '#60a5fa' : 'var(--text-muted)',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                {autoScroll ? 'vertical_align_bottom' : 'vertical_align_center'}
              </span>
              Auto Scroll
            </button>

            {/* Clear */}
            <button
              onClick={clearLogs}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 10px', borderRadius: '7px',
                border: '1px solid var(--border-card)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete_sweep</span>
              Clear
            </button>
          </div>
        </div>

        {/* Log area */}
        <div
          ref={consoleRef}
          style={{
            height: '520px',
            overflowY: 'auto',
            background: '#0d1117',
            padding: '12px 16px',
            fontFamily: '"Fira Code", "Cascadia Code", "Courier New", monospace',
            fontSize: '12.5px',
            lineHeight: '1.7',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#30363d' }}>terminal</span>
              <p style={{ color: '#484f58', fontSize: '13px', margin: 0 }}>
                {connected ? 'Menunggu data dari alat...' : 'Hubungkan USB alat untuk mulai memantau log.'}
              </p>
            </div>
          ) : (
            logs.map(entry => (
              <div key={entry.id} style={{ display: 'flex', gap: '10px', marginBottom: '1px' }}>
                <span style={{ color: '#484f58', flexShrink: 0, userSelect: 'none', minWidth: '70px' }}>
                  {entry.t}
                </span>
                <span style={{ color: getLogColor(entry.msg), wordBreak: 'break-all' }}>
                  {entry.msg}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Usage guide */}
      <div style={{
        marginTop: '16px', padding: '16px 18px', borderRadius: '12px',
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
      }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
          Cara Penggunaan
        </p>
        <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {[
            'Hubungkan NodeMCU ESP8266 ke komputer via kabel USB data.',
            'Pilih baud rate 74880 (default untuk proyek ini).',
            'Klik "Hubungkan USB", pilih COM Port yang sesuai, lalu klik OK.',
            'Log dari Arduino akan tampil secara real-time di layar konsol.',
          ].map((text, i) => (
            <li key={i} style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>{text}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
