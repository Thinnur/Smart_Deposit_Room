import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const BUCKET = 'foto-akses'

export default function CameraPage() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const isCapturing = useRef(false)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [status, setStatus] = useState('Menginisialisasi...')
  const [lastPhoto, setLastPhoto] = useState(null)

  const captureFrame = useCallback(async (record) => {
    if (isCapturing.current) return
    if (!videoRef.current || !canvasRef.current) return
    if (!supabase) return

    isCapturing.current = true
    try {
      setStatus('Memotret...')

      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width  = video.videoWidth  || 1280
      canvas.height = video.videoHeight || 720
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9)
      })

      setStatus('Mengunggah...')

      const logPintuId = record.payload?.log_pintu_id
      const path = `captures/${Date.now()}_${logPintuId ?? 'unknown'}.jpg`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      if (logPintuId) {
        await supabase.from('log_pintu').update({ url_foto: publicUrl }).eq('id', logPintuId)
      }

      await supabase.from('commands').update({ status: 'done' }).eq('id', record.id)

      setLastPhoto(publicUrl)
      setStatus('Selesai ✓')
    } catch (err) {
      console.error('captureFrame:', err)
      setStatus('Error ✗')
      try {
        await supabase?.from('commands').update({ status: 'error' }).eq('id', record.id)
      } catch (_) { /* ignore */ }
    } finally {
      isCapturing.current = false
      setTimeout(() => setStatus('Menunggu...'), 3000)
    }
  }, [])

  const handleManualCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return
    if (isCapturing.current) return

    isCapturing.current = true
    try {
      setStatus('Memotret...')

      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width  = video.videoWidth  || 1280
      canvas.height = video.videoHeight || 720
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9)
      })

      setStatus('Mengunggah...')

      const path = `captures/${Date.now()}_manual.jpg`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      setLastPhoto(publicUrl)
      setStatus('Selesai ✓')
    } catch (err) {
      console.error('handleManualCapture:', err)
      setStatus('Error ✗')
    } finally {
      isCapturing.current = false
      setTimeout(() => setStatus('Menunggu...'), 3000)
    }
  }, [cameraReady])

  // Camera init + pending command recovery
  useEffect(() => {
    let active = true

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setCameraReady(true)
        setCameraError(false)
        setStatus('Menunggu...')

        if (supabase) {
          const { data: pending } = await supabase
            .from('commands')
            .select('*')
            .eq('type', 'CAPTURE_PHOTO')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })

          for (const cmd of (pending ?? [])) {
            if (!active) break
            await captureFrame(cmd)
          }
        }
      } catch (err) {
        if (!active) return
        setCameraError(true)
        setCameraReady(false)
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setStatus('Akses kamera ditolak')
        } else if (err.name === 'NotFoundError') {
          setStatus('Kamera tidak ditemukan')
        } else if (err.name === 'NotReadableError') {
          setStatus('Kamera dipakai aplikasi lain')
        } else {
          setStatus('Kamera tidak tersedia')
        }
        console.error('getUserMedia:', err)
      }
    }

    startCamera()

    return () => {
      active = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [captureFrame])

  // Realtime subscription
  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel('camera-page-commands')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'commands',
          filter: 'type=eq.CAPTURE_PHOTO',
        },
        (payload) => {
          if (payload.new.status === 'pending') captureFrame(payload.new)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [captureFrame])

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        background: 'rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: '18px' }}>photo_camera</span>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em' }}>
          Smart Safe — Kamera Akses
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: cameraError ? '#ef4444' : cameraReady ? '#22c55e' : '#f59e0b',
            boxShadow: cameraError
              ? '0 0 6px #ef4444'
              : cameraReady
                ? '0 0 6px #22c55e'
                : '0 0 6px #f59e0b',
          }} />
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {cameraError ? 'Error' : cameraReady ? 'Ready' : 'Init'}
          </span>
        </div>
      </div>

      {/* Video preview */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            maxHeight: 'calc(100dvh - 160px)',
            aspectRatio: '16/9',
            objectFit: 'cover',
            display: cameraReady ? 'block' : 'none',
          }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {!cameraReady && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            color: '#475569',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px' }}>
              {cameraError ? 'videocam_off' : 'camera_indoor'}
            </span>
            <p style={{ fontSize: '14px', fontWeight: 600 }}>{status}</p>
          </div>
        )}
      </div>

      {/* Bottom bar: status + photo thumbnail + manual capture */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
      }}>
        {/* Status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flex: 1,
          minWidth: 0,
        }}>
          <span className="material-symbols-outlined" style={{
            fontSize: '13px',
            color: status.includes('✓') ? '#22c55e' : status.includes('✗') ? '#ef4444' : '#94a3b8',
          }}>fiber_manual_record</span>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: status.includes('✓') ? '#22c55e' : status.includes('✗') ? '#ef4444' : '#94a3b8',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{status}</span>
        </div>

        {/* Last photo thumbnail */}
        {lastPhoto && (
          <img
            src={lastPhoto}
            alt="Foto terakhir"
            style={{
              width: '48px',
              height: '36px',
              objectFit: 'cover',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.15)',
              flexShrink: 0,
            }}
          />
        )}

        {/* Manual capture button */}
        <button
          onClick={handleManualCapture}
          disabled={!cameraReady || isCapturing.current}
          style={{
            background: cameraReady ? '#3b82f6' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: cameraReady ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
            opacity: cameraReady ? 1 : 0.5,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>photo_camera</span>
          Foto Manual
        </button>
      </div>
    </div>
  )
}
