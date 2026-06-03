import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'

// ─── Helper ───────────────────────────────────────────────────────────────────
const sendRefreshCache = async () => {
  if (!supabase) return
  try { await supabase.from('commands').insert({ type: 'REFRESH_CACHE', status: 'pending' }) } catch {}
}

function findNextFingerprintId(allNasabah, excludeId = null) {
  const used = new Set(
    allNasabah
      .filter(n => n.id !== excludeId && n.fingerprint_id != null)
      .map(n => n.fingerprint_id)
  )
  for (let i = 1; i <= 127; i++) {
    if (!used.has(i)) return i
  }
  return null
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])

  const colors = {
    success: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)', text: '#4ade80', icon: 'check_circle' },
    error:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  text: '#f87171', icon: 'error' },
  }
  const c = colors[type] || colors.success

  return (
    <div style={{
      position: 'fixed', bottom: '28px', right: '28px', zIndex: 200,
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '12px 18px', borderRadius: '12px',
      background: 'var(--bg-card)', border: `1px solid ${c.border}`,
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      animation: 'fade-in 0.3s ease-out',
      maxWidth: '340px',
    }}>
      <span className="material-symbols-outlined" style={{ color: c.text, fontSize: '20px' }}>{c.icon}</span>
      <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)', flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
      </button>
    </div>
  )
}

// ─── Enrollment Dialog ────────────────────────────────────────────────────────
function EnrollmentDialog({ type, nasabahId, fingerprintId, onClose, onSuccess }) {
  const [progress, setProgress] = useState('Mengirim perintah ke alat...')
  const [cmdStatus, setCmdStatus] = useState('sending')
  const [cmdId, setCmdId] = useState(null)
  const isRfid = type === 'ENROLL_RFID'
  const resolvedRef = useRef(false)

  useEffect(() => {
    let active = true
    let channel = null
    let pollTimer = null

    const handleResult = (resultType, value) => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onSuccess(resultType, value)
    }

    const startEnroll = async () => {
      const payload = isRfid
        ? { nasabah_id: nasabahId }
        : { nasabah_id: nasabahId, fingerprint_id: fingerprintId }

      const { data, error } = await supabase
        .from('commands')
        .insert({ type, status: 'pending', payload })
        .select('id')
        .single()

      if (!active) return
      if (error || !data) {
        setProgress('Gagal mengirim perintah ke alat.')
        setCmdStatus('error')
        return
      }

      const id = data.id
      setCmdId(id)
      setCmdStatus('pending')
      setProgress('Menunggu alat merespon... (polling setiap 5 detik)')

      // Realtime subscription
      channel = supabase
        .channel(`enroll-${id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'commands',
          filter: `id=eq.${id}`,
        }, ({ new: updated }) => {
          if (!active) return
          const prog = updated.payload?.progress || ''
          if (prog) setProgress(prog)
          const st = updated.status
          setCmdStatus(st === 'pending' ? 'progress' : st)
          if (st === 'done') {
            if (isRfid) handleResult('rfid', updated.payload?.rfid_uid || '')
            else handleResult('fp', updated.payload?.fingerprint_id)
          }
        })
        .subscribe()

      // Polling fallback every 3s
      pollTimer = setInterval(async () => {
        if (!active || resolvedRef.current) return
        const { data: row } = await supabase
          .from('commands')
          .select('status, payload')
          .eq('id', id)
          .single()
        if (!row || !active) return
        const prog = row.payload?.progress || ''
        if (prog) setProgress(prog)
        const st = row.status
        if (st !== 'pending') setCmdStatus(st)
        if (st === 'done') {
          clearInterval(pollTimer)
          if (isRfid) handleResult('rfid', row.payload?.rfid_uid || '')
          else handleResult('fp', row.payload?.fingerprint_id)
        } else if (st === 'error') {
          clearInterval(pollTimer)
        } else if (st === 'cancelled') {
          clearInterval(pollTimer)
          if (active) onClose()
        }
      }, 3000)
    }

    startEnroll()

    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [])

  const handleCancel = async () => {
    if (cmdId && cmdStatus !== 'done' && cmdStatus !== 'error') {
      try { await supabase.from('commands').update({ status: 'cancelled' }).eq('id', cmdId) } catch {}
    }
    onClose()
  }

  const isDone  = cmdStatus === 'done'
  const isError = cmdStatus === 'error'
  const isActive = !isDone && !isError

  const statusColor = isDone ? '#4ade80' : isError ? '#f87171' : '#60a5fa'
  const statusIcon  = isDone ? 'check_circle' : isError ? 'error' : 'sensors'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '28px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
            background: isRfid
              ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)'
              : 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '22px' }}>
              {isRfid ? 'nfc' : 'fingerprint'}
            </span>
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {isRfid ? 'Pendaftaran RFID' : 'Pendaftaran Sidik Jari'}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {isRfid ? 'Scan kartu via sensor alat' : `Slot ID #${fingerprintId}`}
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div style={{
          padding: '18px', borderRadius: '12px',
          background: 'var(--bg-body)',
          border: `1px solid ${statusColor}44`,
          marginBottom: '20px',
          display: 'flex', alignItems: 'flex-start', gap: '12px',
        }}>
          <span className="material-symbols-outlined" style={{
            color: statusColor, fontSize: '22px', flexShrink: 0,
            animation: isActive ? 'pulse-icon 1.5s ease-in-out infinite' : 'none',
          }}>
            {statusIcon}
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '13.5px', color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 4px' }}>
              {isDone ? 'Pendaftaran Berhasil!' : isError ? 'Pendaftaran Gagal' : 'Proses Pendaftaran...'}
            </p>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {progress}
            </p>
          </div>
        </div>

        {/* Step guide (FP only) */}
        {!isRfid && isActive && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            {['Tempel Jari 1', 'Angkat Jari', 'Tempel Jari 2'].map((label, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: '3px', borderRadius: '2px',
                  background: 'rgba(139,92,246,0.25)',
                  marginBottom: '5px',
                }} />
                <span style={{ fontSize: '10px', color: 'var(--text-subtle)' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {!isDone && (
            <button
              onClick={handleCancel}
              style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                border: '1px solid var(--border-card)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: '13.5px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {isError ? 'Tutup' : 'Batal'}
            </button>
          )}
          {isDone && (
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg,#22c55e,#15803d)',
                color: 'white', fontSize: '13.5px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
              }}
            >
              Selesai
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal Form ───────────────────────────────────────────────────────────────
function NasabahModal({ onClose, onSuccess, editData, allNasabah }) {
  const isEdit = !!editData
  const [form, setForm] = useState({
    nama: editData?.nama || '',
    rfid_uid: editData?.rfid_uid || '',
    fingerprint_id: editData?.fingerprint_id ?? '',
  })
  const [selectedLoker, setSelectedLoker] = useState('')
  const [availableLokers, setAvailableLokers] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchingLokers, setFetchingLokers] = useState(true)
  const [enrollDialog, setEnrollDialog] = useState(null)
  // nasabah baru yang baru saja di-insert — mengaktifkan tombol scan tanpa menutup modal
  const [savedNasabah, setSavedNasabah] = useState(null)

  const canScan    = isEdit || !!savedNasabah
  const enrollId   = editData?.id || savedNasabah?.id

  useEffect(() => {
    const fetchLokers = async () => {
      setFetchingLokers(true)
      const { data, error } = await supabase
        .from('loker')
        .select('id, nomor_loker')
        .is('id_nasabah', null)
        .order('nomor_loker', { ascending: true })
      if (!error && data) setAvailableLokers(data)
      setFetchingLokers(false)
    }
    fetchLokers()
  }, [])

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.nama.trim()) return
    setLoading(true)
    try {
      if (isEdit) {
        const { error } = await supabase
          .from('nasabah')
          .update({
            nama: form.nama.trim(),
            rfid_uid: form.rfid_uid.trim() || null,
            fingerprint_id: form.fingerprint_id !== '' ? parseInt(form.fingerprint_id) : null,
          })
          .eq('id', editData.id)
        if (error) throw error
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('nasabah')
          .insert([{
            nama: form.nama.trim(),
            rfid_uid: form.rfid_uid.trim() || null,
            fingerprint_id: form.fingerprint_id !== '' ? parseInt(form.fingerprint_id) : null,
          }])
          .select()
          .single()
        if (insertErr) throw insertErr

        if (selectedLoker && inserted?.id) {
          const { error: lokerErr } = await supabase
            .from('loker')
            .update({ id_nasabah: inserted.id })
            .eq('id', selectedLoker)
          if (lokerErr) throw lokerErr
        }
        await sendRefreshCache()
        // Jangan tutup modal — switch ke mode scan sensor
        setSavedNasabah(inserted)
        setLoading(false)
        return
      }
      await sendRefreshCache()
      onSuccess('Data nasabah berhasil diperbarui.')
    } catch (err) {
      console.error(err)
      onSuccess('Terjadi kesalahan: ' + (err.message || 'Unknown error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const openRfidEnroll = () => {
    setEnrollDialog({ type: 'ENROLL_RFID', nasabahId: enrollId, fpTargetId: null })
  }

  const openFpEnroll = () => {
    const currentFpId = form.fingerprint_id !== '' ? parseInt(form.fingerprint_id) : null
    const fpTargetId = currentFpId || findNextFingerprintId(allNasabah, enrollId)
    if (!fpTargetId) {
      alert('Semua slot sidik jari (1-127) sudah terisi.')
      return
    }
    setEnrollDialog({ type: 'ENROLL_FP', nasabahId: enrollId, fpTargetId })
  }

  const inputStyle = {
    width: '100%', padding: '9px 13px',
    background: 'var(--bg-body)', border: '1px solid var(--border-card)',
    borderRadius: '9px', color: 'var(--text-primary)',
    fontSize: '13.5px', outline: 'none',
    transition: 'border-color 0.15s ease',
    fontFamily: 'var(--font-sans)',
  }
  const labelStyle = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const scanBtnStyle = {
    padding: '9px 11px', borderRadius: '9px', border: '1px solid var(--border-card)',
    background: 'var(--bg-body)', color: 'var(--text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0,
    transition: 'all 0.15s ease',
  }

  return (
    <>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '480px', padding: '28px', margin: '16px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: savedNasabah ? 'linear-gradient(135deg,#22c55e,#15803d)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '18px' }}>{savedNasabah ? 'check_circle' : isEdit ? 'edit' : 'person_add'}</span>
              </div>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {savedNasabah ? 'Nasabah Ditambahkan!' : isEdit ? 'Edit Nasabah' : 'Tambah Nasabah'}
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {savedNasabah ? 'Daftarkan sensor (opsional), lalu klik Selesai' : isEdit ? 'Perbarui data nasabah' : 'Isi data nasabah baru'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="topbar-btn"><span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span></button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Nama Lengkap *</label>
              <input name="nama" value={form.nama} onChange={handleChange} required placeholder="Masukkan nama nasabah" style={inputStyle} />
            </div>

            {/* RFID + scan button */}
            <div>
              <label style={labelStyle}>UID RFID</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input name="rfid_uid" value={form.rfid_uid} onChange={handleChange} placeholder="Contoh: A3F2B1C4" style={{ ...inputStyle, flex: 1 }} />
                {canScan && (
                  <button
                    type="button"
                    onClick={openRfidEnroll}
                    title="Scan RFID via alat"
                    style={scanBtnStyle}
                    onMouseOver={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#60a5fa' }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-card)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>nfc</span>
                  </button>
                )}
              </div>
              {canScan && (
                <p style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '5px' }}>
                  Klik ikon NFC untuk mendaftarkan kartu langsung dari sensor alat.
                </p>
              )}
            </div>

            {/* Fingerprint + scan button */}
            <div>
              <label style={labelStyle}>ID Fingerprint</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  name="fingerprint_id"
                  type="number"
                  value={form.fingerprint_id}
                  onChange={handleChange}
                  placeholder="Nomor ID fingerprint (1-127)"
                  style={{ ...inputStyle, flex: 1 }}
                />
                {canScan && (
                  <button
                    type="button"
                    onClick={openFpEnroll}
                    title="Daftarkan sidik jari via alat"
                    style={scanBtnStyle}
                    onMouseOver={e => { e.currentTarget.style.borderColor = '#8b5cf6'; e.currentTarget.style.color = '#c084fc' }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-card)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>fingerprint</span>
                  </button>
                )}
              </div>
              {canScan && (
                <p style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '5px' }}>
                  Klik ikon sidik jari untuk mendaftarkan langsung dari sensor alat.
                </p>
              )}
            </div>

            {!isEdit && !savedNasabah && (
              <div>
                <label style={labelStyle}>Alokasi Loker (Opsional)</label>
                <select
                  value={selectedLoker}
                  onChange={(e) => setSelectedLoker(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  disabled={fetchingLokers}
                >
                  <option value="">{fetchingLokers ? 'Memuat loker...' : '— Pilih loker tersedia —'}</option>
                  {availableLokers.map(l => (
                    <option key={l.id} value={l.id}>Loker #{l.nomor_loker}</option>
                  ))}
                </select>
                {!fetchingLokers && availableLokers.length === 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '5px' }}>Tidak ada loker yang tersedia saat ini.</p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                border: '1px solid var(--border-card)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: '13.5px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}>{savedNasabah ? 'Lewati' : 'Batal'}</button>

              {savedNasabah ? (
                <button
                  type="button"
                  onClick={() => onSuccess('Nasabah berhasil ditambahkan.')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '10px',
                    border: 'none', background: 'linear-gradient(135deg,#22c55e,#15803d)',
                    color: 'white', fontSize: '13.5px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
                  Selesai
                </button>
              ) : (
                <button type="submit" disabled={loading} style={{
                  flex: 1, padding: '10px', borderRadius: '10px',
                  border: 'none', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
                  color: 'white', fontSize: '13.5px', fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.75 : 1,
                  fontFamily: 'var(--font-sans)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
                }}>
                  {loading && <span className="material-symbols-outlined" style={{ fontSize: '16px', animation: 'bounce-dot 0.8s ease-in-out infinite' }}>sync</span>}
                  {loading ? 'Menyimpan...' : (isEdit ? 'Simpan Perubahan' : 'Tambah Nasabah')}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Enrollment dialog — rendered above modal */}
      {enrollDialog && (
        <EnrollmentDialog
          type={enrollDialog.type}
          nasabahId={enrollDialog.nasabahId}
          fingerprintId={enrollDialog.fpTargetId}
          onClose={() => setEnrollDialog(null)}
          onSuccess={(resultType, value) => {
            if (resultType === 'rfid') {
              setForm(f => ({ ...f, rfid_uid: value || '' }))
            } else {
              setForm(f => ({ ...f, fingerprint_id: value ?? '' }))
            }
            setEnrollDialog(null)
          }}
        />
      )}
    </>
  )
}

// ─── Loker Modal ──────────────────────────────────────────────────────────────
function LokerModal({ onClose, onSuccess }) {
  const [nomorLoker, setNomorLoker] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmedNomor = nomorLoker.trim()
    if (!trimmedNomor) return

    setLoading(true)
    try {
      const { error } = await supabase
        .from('loker')
        .insert([{ nomor_loker: trimmedNomor, id_nasabah: null }])

      if (error) throw error
      await sendRefreshCache()
      onSuccess(`Loker "${trimmedNomor}" berhasil ditambahkan.`)
    } catch (err) {
      console.error(err)
      onSuccess('Terjadi kesalahan: ' + (err.message || 'Unknown error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '9px 13px',
    background: 'var(--bg-body)', border: '1px solid var(--border-card)',
    borderRadius: '9px', color: 'var(--text-primary)',
    fontSize: '13.5px', outline: 'none',
    transition: 'border-color 0.15s ease',
    fontFamily: 'var(--font-sans)',
  }
  const labelStyle = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '28px', margin: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '18px' }}>add_home</span>
            </div>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Tambah Loker</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Buat loker baru yang tersedia</p>
            </div>
          </div>
          <button onClick={onClose} className="topbar-btn"><span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Nomor Loker *</label>
            <input value={nomorLoker} onChange={(e) => setNomorLoker(e.target.value)} required placeholder="A-05" style={inputStyle} />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px', borderRadius: '10px',
              border: '1px solid var(--border-card)', background: 'transparent',
              color: 'var(--text-secondary)', fontSize: '13.5px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>Batal</button>
            <button type="submit" disabled={loading} style={{
              flex: 1, padding: '10px', borderRadius: '10px',
              border: 'none', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
              color: 'white', fontSize: '13.5px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
              fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
            }}>
              {loading && <span className="material-symbols-outlined" style={{ fontSize: '16px', animation: 'bounce-dot 0.8s ease-in-out infinite' }}>sync</span>}
              {loading ? 'Menyimpan...' : 'Tambah Loker'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd }) {
  return (
    <tr>
      <td colSpan={5} style={{ textAlign: 'center', padding: '56px 20px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--text-subtle)', display: 'block', marginBottom: '12px' }}>group</span>
        <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)', margin: '0 0 6px' }}>Belum ada nasabah</p>
        <p style={{ fontSize: '13px', color: 'var(--text-subtle)', marginBottom: '18px' }}>Klik tombol di atas untuk menambahkan nasabah pertama.</p>
        <button onClick={onAdd} style={{
          padding: '8px 18px', borderRadius: '9px', border: 'none',
          background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', color: 'white',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        }}>+ Tambah Nasabah</button>
      </td>
    </tr>
  )
}

function EmptyLokerState({ onAdd }) {
  return (
    <tr>
      <td colSpan={4} style={{ textAlign: 'center', padding: '56px 20px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--text-subtle)', display: 'block', marginBottom: '12px' }}>inventory_2</span>
        <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)', margin: '0 0 6px' }}>Belum ada loker</p>
        <p style={{ fontSize: '13px', color: 'var(--text-subtle)', marginBottom: '18px' }}>Tambahkan loker baru untuk mulai mengelola ketersediaan.</p>
        <button onClick={onAdd} style={{
          padding: '8px 18px', borderRadius: '9px', border: 'none',
          background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', color: 'white',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        }}>+ Tambah Loker Baru</button>
      </td>
    </tr>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CustomerManagement() {
  const [nasabahList, setNasabahList]   = useState([])
  const [lokerList, setLokerList]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [lokerLoading, setLokerLoading] = useState(true)
  const [activeTab, setActiveTab]       = useState('nasabah')
  const [showModal, setShowModal]       = useState(false)
  const [showLokerModal, setShowLokerModal] = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [toast, setToast]               = useState(null)
  const [searchQuery, setSearchQuery]   = useState('')

  const showToast = (message, type = 'success') => setToast({ message, type })

  const fetchNasabah = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('nasabah')
        .select('*, loker(id, nomor_loker)')
        .order('nama', { ascending: true })
      if (!error && data) setNasabahList(data)
      else if (error) console.error('fetchNasabah:', error)
    } catch (e) {
      console.error('fetchNasabah:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLokers = useCallback(async () => {
    if (!supabase) return
    setLokerLoading(true)
    try {
      const { data, error } = await supabase
        .from('loker')
        .select('id, nomor_loker, id_nasabah, nasabah(id, nama)')
        .order('nomor_loker', { ascending: true })
      if (!error && data) setLokerList(data)
      else if (error) console.error('fetchLokers:', error)
    } catch (e) {
      console.error('fetchLokers:', e)
    } finally {
      setLokerLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) { fetchNasabah(); fetchLokers() }
    })
    return () => { active = false }
  }, [fetchNasabah, fetchLokers])

  const handleDelete = async (nasabah) => {
    if (!window.confirm(`Hapus nasabah "${nasabah.nama}"?\nSemua data terkait akan dihapus.`)) return
    try {
      if (nasabah.loker?.length > 0) {
        await supabase.from('loker').update({ id_nasabah: null }).eq('id_nasabah', nasabah.id)
      }
      const { error } = await supabase.from('nasabah').delete().eq('id', nasabah.id)
      if (error) throw error
      await sendRefreshCache()
      showToast(`Nasabah "${nasabah.nama}" berhasil dihapus.`)
      fetchNasabah()
      fetchLokers()
    } catch (err) {
      showToast('Gagal menghapus: ' + (err.message || 'Unknown error'), 'error')
    }
  }

  const handleModalSuccess = (msg, type = 'success') => {
    setShowModal(false)
    setEditTarget(null)
    showToast(msg, type)
    if (type === 'success') { fetchNasabah(); fetchLokers() }
  }

  const handleLokerModalSuccess = (msg, type = 'success') => {
    setShowLokerModal(false)
    showToast(msg, type)
    if (type === 'success') { fetchLokers(); fetchNasabah() }
  }

  const handleDeleteLoker = async (loker) => {
    if (!window.confirm(`Hapus loker "${loker.nomor_loker}"?\nData nasabah tidak akan dihapus.`)) return
    try {
      const { error } = await supabase.from('loker').delete().eq('id', loker.id)
      if (error) throw error
      await sendRefreshCache()
      showToast(`Loker "${loker.nomor_loker}" berhasil dihapus.`)
      fetchLokers(); fetchNasabah()
    } catch (err) {
      showToast('Gagal menghapus loker: ' + (err.message || 'Unknown error'), 'error')
    }
  }

  const openEdit    = (nasabah) => { setEditTarget(nasabah); setShowModal(true) }
  const openAdd     = () => { setEditTarget(null); setShowModal(true) }
  const openAddLoker = () => setShowLokerModal(true)

  const filtered = nasabahList.filter(n =>
    n.nama?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.rfid_uid?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const SkeletonRow = ({ columns = 5 }) => (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: '12px 16px' }}>
          <div style={{ height: '14px', borderRadius: '6px', background: 'var(--border-card)', opacity: 0.5 }} />
        </td>
      ))}
    </tr>
  )

  return (
    <div style={{ animation: 'fade-in 0.4s ease-out' }}>
      {/* ── Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Manajemen Nasabah</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Kelola data nasabah dan alokasi loker
          </p>
        </div>
        {activeTab === 'nasabah' && (
          <button onClick={openAdd} style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '10px 18px', borderRadius: '11px', border: 'none',
            background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
            color: 'white', fontSize: '13.5px', fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            boxShadow: '0 4px 16px rgba(59,130,246,0.35)',
            transition: 'opacity 0.2s',
          }}
            onMouseOver={e => e.currentTarget.style.opacity = '0.88'}
            onMouseOut={e => e.currentTarget.style.opacity = '1'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person_add</span>
            Tambah Nasabah
          </button>
        )}
      </div>

      {/* ── Tabs */}
      <div style={{ display: 'inline-flex', padding: '4px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-card)', marginBottom: '16px', gap: '4px' }}>
        {[
          { id: 'nasabah', label: 'Data Nasabah', icon: 'group' },
          { id: 'loker', label: 'Data Loker', icon: 'inventory_2' },
        ].map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 14px', borderRadius: '9px', border: 'none',
                background: isActive ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)' : 'transparent',
                color: isActive ? 'white' : 'var(--text-muted)',
                fontSize: '13px', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                boxShadow: isActive ? '0 4px 14px rgba(59,130,246,0.25)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {activeTab === 'nasabah' ? (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-table)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#3b82f6' }}>group</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Daftar Nasabah</span>
                {!loading && (
                  <span style={{ padding: '2px 9px', borderRadius: '99px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', fontSize: '11.5px', fontWeight: 700, color: '#60a5fa' }}>
                    {filtered.length}
                  </span>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', color: 'var(--text-muted)', pointerEvents: 'none' }}>search</span>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari nama / RFID..."
                  style={{
                    padding: '8px 12px 8px 34px',
                    background: 'var(--bg-body)', border: '1px solid var(--border-card)',
                    borderRadius: '9px', color: 'var(--text-primary)', fontSize: '13px',
                    outline: 'none', width: '220px', fontFamily: 'var(--font-sans)',
                  }}
                />
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Nama</th>
                    <th>UID RFID</th>
                    <th>ID Fingerprint</th>
                    <th>Loker</th>
                    <th style={{ textAlign: 'right' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : filtered.length === 0 ? (
                    <EmptyState onAdd={openAdd} />
                  ) : (
                    filtered.map(n => {
                      const nLokerList = n.loker || []
                      return (
                        <tr key={n.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                                background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '13px', fontWeight: 700, color: 'white',
                              }}>
                                {n.nama?.charAt(0).toUpperCase() || '?'}
                              </div>
                              <div>
                                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '13.5px' }}>{n.nama}</p>
                                <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{n.id.slice(0, 8)}…</p>
                              </div>
                            </div>
                          </td>
                          <td>
                            {n.rfid_uid
                              ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa' }}>{n.rfid_uid}</span>
                              : <span style={{ color: 'var(--text-subtle)', fontSize: '12px' }}>—</span>}
                          </td>
                          <td>
                            {n.fingerprint_id != null
                              ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: '#c084fc' }}>#{n.fingerprint_id}</span>
                              : <span style={{ color: 'var(--text-subtle)', fontSize: '12px' }}>—</span>}
                          </td>
                          <td>
                            {nLokerList.length > 0
                              ? nLokerList.map(l => (
                                <span key={l.id} className="badge badge-success" style={{ marginRight: '4px' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>lock</span>
                                  #{l.nomor_loker}
                                </span>
                              ))
                              : <span className="badge badge-warning">
                                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>lock_open</span>
                                  Belum ada
                                </span>
                            }
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                              <button
                                onClick={() => openEdit(n)}
                                title="Edit"
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '5px',
                                  padding: '6px 12px', borderRadius: '8px',
                                  border: '1px solid var(--border-card)',
                                  background: 'transparent', color: 'var(--text-muted)',
                                  fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                                  fontFamily: 'var(--font-sans)', transition: 'all 0.15s ease',
                                }}
                                onMouseOver={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#60a5fa' }}
                                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-card)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(n)}
                                title="Hapus"
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '5px',
                                  padding: '6px 12px', borderRadius: '8px',
                                  border: '1px solid rgba(239,68,68,0.25)',
                                  background: 'rgba(239,68,68,0.06)', color: '#f87171',
                                  fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                                  fontFamily: 'var(--font-sans)', transition: 'all 0.15s ease',
                                }}
                                onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.14)' }}
                                onMouseOut={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                                Hapus
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {!loading && filtered.length > 0 && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-table)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Menampilkan <strong style={{ color: 'var(--text-secondary)' }}>{filtered.length}</strong> dari <strong style={{ color: 'var(--text-secondary)' }}>{nasabahList.length}</strong> nasabah
                </p>
                <button onClick={fetchNasabah} style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
                  Refresh
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-table)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#3b82f6' }}>inventory_2</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Daftar Loker</span>
                {!lokerLoading && (
                  <span style={{ padding: '2px 9px', borderRadius: '99px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', fontSize: '11.5px', fontWeight: 700, color: '#60a5fa' }}>
                    {lokerList.length}
                  </span>
                )}
              </div>
              <button onClick={openAddLoker} style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '9px 16px', borderRadius: '10px', border: 'none',
                background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
                color: 'white', fontSize: '13px', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                boxShadow: '0 4px 14px rgba(59,130,246,0.32)',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>add</span>
                Tambah Loker Baru
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nomor Loker</th>
                    <th>Status</th>
                    <th>Pemilik</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lokerLoading ? (
                    Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={4} />)
                  ) : lokerList.length === 0 ? (
                    <EmptyLokerState onAdd={openAddLoker} />
                  ) : (
                    lokerList.map(l => {
                      const isOccupied = !!l.id_nasabah
                      const ownerName = Array.isArray(l.nasabah) ? l.nasabah[0]?.nama : l.nasabah?.nama
                      return (
                        <tr key={l.id}>
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                              #{l.nomor_loker}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${isOccupied ? 'badge-warning' : 'badge-success'}`}>
                              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>{isOccupied ? 'lock' : 'lock_open'}</span>
                              {isOccupied ? 'Terisi' : 'Tersedia'}
                            </span>
                          </td>
                          <td>
                            {ownerName
                              ? <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>{ownerName}</span>
                              : <span style={{ color: 'var(--text-subtle)', fontSize: '12px' }}>-</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => handleDeleteLoker(l)}
                              title="Hapus"
                              style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                padding: '6px 12px', borderRadius: '8px',
                                border: '1px solid rgba(239,68,68,0.25)',
                                background: 'rgba(239,68,68,0.06)', color: '#f87171',
                                fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                                fontFamily: 'var(--font-sans)', transition: 'all 0.15s ease',
                              }}
                              onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.14)' }}
                              onMouseOut={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                              Hapus
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {!lokerLoading && lokerList.length > 0 && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-table)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Menampilkan <strong style={{ color: 'var(--text-secondary)' }}>{lokerList.length}</strong> loker
                </p>
                <button onClick={fetchLokers} style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
                  Refresh
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal */}
      {showModal && (
        <NasabahModal
          editData={editTarget}
          allNasabah={nasabahList}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onSuccess={handleModalSuccess}
        />
      )}

      {showLokerModal && (
        <LokerModal
          onClose={() => setShowLokerModal(false)}
          onSuccess={handleLokerModalSuccess}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
