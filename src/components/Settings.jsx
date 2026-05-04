import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const inputStyle = {
  width: '100%',
  padding: '11px 13px',
  borderRadius: '10px',
  border: '1px solid var(--border-card)',
  background: 'rgba(15, 23, 42, 0.62)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-secondary)',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

export default function Settings() {
  const [form, setForm] = useState({ jam_buka: '', jam_tutup: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const fetchSettings = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setMessage({ type: 'error', text: 'Konfigurasi Supabase belum tersedia.' })
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('jam_buka, jam_tutup')
        .eq('id', 1)
        .single()

      if (error) throw error
      setForm({
        jam_buka: data?.jam_buka?.slice(0, 5) || '',
        jam_tutup: data?.jam_tutup?.slice(0, 5) || '',
      })
    } catch (err) {
      console.error('fetchSettings:', err)
      setMessage({ type: 'error', text: 'Gagal memuat pengaturan sistem.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) fetchSettings()
    })
    return () => { active = false }
  }, [fetchSettings])

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setMessage(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.jam_buka || !form.jam_tutup) {
      setMessage({ type: 'error', text: 'Jam buka dan jam tutup wajib diisi.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({
          jam_buka: form.jam_buka,
          jam_tutup: form.jam_tutup,
        })
        .eq('id', 1)

      if (error) throw error
      setMessage({ type: 'success', text: 'Pengaturan operasional berhasil disimpan.' })
    } catch (err) {
      console.error('updateSettings:', err)
      setMessage({ type: 'error', text: 'Gagal menyimpan pengaturan sistem.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.4s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          Pengaturan Sistem
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          Atur jam operasional Smart Safe Deposit Box.
        </p>
      </div>

      <div className="glass-card" style={{ maxWidth: '720px', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-table)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px',
            background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(59,130,246,0.32)',
          }}>
            <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '19px' }}>schedule</span>
          </div>
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Jam Operasional
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Berlaku untuk kontrol akses sistem.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {message && (
            <div style={{
              padding: '11px 14px',
              borderRadius: '10px',
              border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
              background: message.type === 'success' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
              color: message.type === 'success' ? '#4ade80' : '#f87171',
              fontSize: '13px',
              fontWeight: 600,
            }}>
              {message.text}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="jam_buka" style={labelStyle}>Jam Operasional Buka</label>
              <input
                id="jam_buka"
                name="jam_buka"
                type="time"
                value={form.jam_buka}
                onChange={handleChange}
                disabled={loading || saving}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="jam_tutup" style={labelStyle}>Jam Operasional Tutup</label>
              <input
                id="jam_tutup"
                name="jam_tutup"
                type="time"
                value={form.jam_tutup}
                onChange={handleChange}
                disabled={loading || saving}
                required
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '6px' }}>
            <button
              type="button"
              onClick={fetchSettings}
              disabled={loading || saving}
              style={{
                padding: '10px 15px',
                borderRadius: '10px',
                border: '1px solid var(--border-card)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 700,
                cursor: loading || saving ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={loading || saving}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                padding: '10px 18px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
                color: 'white',
                fontSize: '13px',
                fontWeight: 800,
                cursor: loading || saving ? 'not-allowed' : 'pointer',
                opacity: loading || saving ? 0.72 : 1,
                fontFamily: 'var(--font-sans)',
                boxShadow: '0 4px 14px rgba(59,130,246,0.32)',
              }}
            >
              {(loading || saving) && <span className="material-symbols-outlined animate-bounce-dot" style={{ fontSize: '16px' }}>sync</span>}
              {saving ? 'Menyimpan...' : loading ? 'Memuat...' : 'Simpan Pengaturan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
